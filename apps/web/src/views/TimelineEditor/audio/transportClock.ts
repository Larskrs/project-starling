/**
 * The client's estimate of the server clock, and the gate that stops a
 * transport anchor being read before that estimate exists.
 *
 * The server sends anchors as `{ frame, at }` — "the playhead was at `frame`
 * when my clock said `at`". The position now is `frame + (serverNow − at) × fps`,
 * so everything hangs on `serverNow()`: our own clock plus a measured offset.
 *
 * Three rules this module exists to enforce:
 *
 * 1. Anchors are read through the clock at USE time, never converted once.
 *    The estimate keeps improving — the first ping is the roughest, often sent
 *    over long-polling before the websocket upgrade — and a server stamp mapped
 *    to local time on arrival freezes that first error into the anchor until
 *    somebody presses play again. Consumers keep `at` and call serverNow().
 *
 * 2. An anchor is never read before any offset exists. A client joining a room
 *    mid-playback is sent the anchor immediately, before its first ping lands;
 *    read with no offset, `at` is compared against our own unrelated clock and
 *    the joiner lands anywhere. Early anchors are held, and released by the
 *    first sample.
 *
 * 3. Our side is a monotonic clock. Date.now() steps whenever the OS corrects
 *    it or someone sets the time; a monotonic clock cannot, so the offset only
 *    goes wrong when a clock stands still (the machine slept) or the server
 *    restarts — and the consistency check in addSample catches both on the
 *    next ping.
 *
 * Vue-free and socket-free so the timing rules can be tested in bare node —
 * see transportClock.test.ts. Scheduling the pings is useTimelineSync's job.
 */
import type { PlayheadAnchor } from '../../../types/timeline'

/** One completed round trip against the server clock. */
export interface ClockPing {
  /** Local ms when the ping was sent. */
  t0: number
  /** Local ms when the reply landed. */
  t2: number
  /** Server's own clock reading, from the reply. */
  serverNow: number
}

export interface TransportClockOptions {
  /** Called with an anchor once the clock offset is known. */
  deliver?: (anchor: PlayheadAnchor) => void
  now?: () => number
}

interface Sample {
  offset: number
  rtt: number
  /** Local ms the sample was taken, for ageing it out. */
  at: number
}

/** Local ms on a clock that never steps: epoch-like values, monotonic ticks. */
export function monotonicNow(): number {
  return performance.timeOrigin + performance.now()
}

// The two clocks tick at slightly different rates (tens of ppm), so a sample
// describes an offset that slowly stops being true. Two minutes costs a few ms
// at worst; past that a low round trip no longer earns a sample its place.
const MAX_SAMPLE_AGE_MS = 120_000
const MAX_SAMPLES       = 24

// Allowance on the consistency check for browser timer coarsening and the
// drift tolerated above.
const CONSISTENCY_SLACK_MS = 10

// A new estimate further than this from the applied offset is adopted at once:
// the playhead is a frame or more out, and being right matters more than being
// smooth. Anything closer is glided towards at SLEW_MS_PER_S, so a routine
// re-measurement never twitches the playhead or nudges audio.
const STEP_MS       = 40
const SLEW_MS_PER_S = 5

export function createTransportClock(
  { deliver, now = monotonicNow }: TransportClockOptions = {},
) {
  let samples: Sample[] = []
  let pending: PlayheadAnchor | null = null   // anchor held back while no offset is known

  // The applied offset (serverNow − localNow) glides from `from`, as of local
  // time `since`, towards `target`. `target` is null until a ping lands.
  let target: number | null = null
  let from  = 0
  let since = 0

  function offsetAt(t: number): number | null {
    if (target === null) return null
    const room = (SLEW_MS_PER_S * Math.max(0, t - since)) / 1000
    return from + Math.max(-room, Math.min(room, target - from))
  }

  function retarget(next: number, t: number, jump: boolean): void {
    const current = offsetAt(t)
    from   = current === null || jump || Math.abs(next - current) > STEP_MS ? next : current
    since  = t
    target = next
  }

  function flush() {
    if (!pending) return
    const state = pending
    pending = null
    deliver?.(state)
  }

  return {
    /** The offset currently applied, in ms; null until a ping lands. */
    get offset() { return offsetAt(now()) },
    get hasPending() { return pending !== null },
    /**
     * Round trip of the best sample the estimate rests on — the offset is never
     * wrong by more than half this. Null before any sample. What a client
     * reports when the room asks for a clock resync.
     */
    get rtt() { return samples.length ? Math.min(...samples.map(s => s.rtt)) : null },

    /**
     * Fold in one completed ping.
     *
     * The server read its clock somewhere between our t0 and t2, so the true
     * offset lies in [serverNow − t2, serverNow − t0] — a bound, not an
     * assumption about the network. The midpoint is the estimate and rtt/2 its
     * worst-case error, which is why the lowest-RTT sample in the window wins:
     * latency only ever adds, and a slow ping is slow because it queued, usually
     * on one leg. Averaging would mix that asymmetry into the clean samples.
     *
     * The same bound catches a clock that jumped. Against continuous clocks two
     * samples' intervals must overlap; when a new one does not overlap an older
     * one, something stood still or restarted, the older sample describes a
     * relationship that no longer exists, and it goes — otherwise its better
     * round trip would outvote the truth indefinitely.
     */
    addSample({ t0, t2, serverNow }: ClockPing): void {
      if (typeof serverNow !== 'number' || !Number.isFinite(serverNow)) return
      const rtt = t2 - t0
      if (!Number.isFinite(rtt) || rtt < 0) return

      const sample: Sample = { offset: serverNow + rtt / 2 - t2, rtt, at: t2 }
      const fresh  = samples.filter(s => sample.at - s.at <= MAX_SAMPLE_AGE_MS)
      const agree  = fresh.filter(s =>
        Math.abs(s.offset - sample.offset) <= (s.rtt + sample.rtt) / 2 + CONSISTENCY_SLACK_MS)
      samples = [...agree, sample].slice(-MAX_SAMPLES)

      const best  = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a))
      const first = target === null
      retarget(best.offset, now(), agree.length < fresh.length)
      // The first sample releases a held anchor straight away: a rough offset
      // beats none, and because anchors are read at use time, the joiner
      // tightens up as better samples arrive without anything being re-sent.
      if (first) flush()
    },

    /**
     * End of a burst. Releases a held anchor even if no ping ever answered —
     * a burst that produced nothing has no better answer coming, and a
     * stranded anchor means a client that never plays.
     */
    settle(): void {
      flush()
    },

    /** The server's clock right now; our own clock while no offset is known. */
    serverNow(): number {
      const t = now()
      return t + (offsetAt(t) ?? 0)
    },

    /**
     * Take an anchor from the server. Delivered immediately once the clock is
     * known, otherwise held — only the newest is kept, since an older anchor
     * describes the same transport less recently.
     */
    accept(state: PlayheadAnchor): boolean {
      if (target === null) { pending = state; return false }
      deliver?.(state)
      return true
    },

    /**
     * Drop anything held — the room being left is no longer ours to follow.
     * Samples and the offset survive: the bound each sample carries holds on any
     * network path, so a reconnect has nothing to unlearn, and a rejoin is not
     * gated. A server that restarted meanwhile is caught by the consistency
     * check as soon as the reconnect's pings land.
     */
    reset(): void {
      pending = null
    },
  }
}
