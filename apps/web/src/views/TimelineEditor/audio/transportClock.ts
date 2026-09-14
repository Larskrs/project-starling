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
 * The estimate itself is cino-sdk's createServerClock, the same one every
 * device following a timeline uses: the fastest recent sample wins, a sample
 * that contradicts older ones means a clock jumped and is believed at once, and
 * small corrections glide. This module adds rule 2 on top, and is itself a
 * ServerClock, so the SDK's startClockSync can feed it directly.
 *
 * Vue-free and socket-free so the timing rules can be tested in bare node —
 * see transportClock.test.ts. Scheduling the pings is useTimelineSync's job.
 */
import { createServerClock, monotonicNow, type ClockPing, type SampleOutcome, type ServerClock } from 'cino-sdk'
import type { PlayheadAnchor } from '../../../types/timeline'

export type { ClockPing }

export interface TransportClockOptions {
  /** Called with an anchor once the clock offset is known. */
  deliver?: (anchor: PlayheadAnchor) => void
  now?: () => number
}

export function createTransportClock(
  { deliver, now = monotonicNow }: TransportClockOptions = {},
) {
  const clock = createServerClock({ now })
  let pending: PlayheadAnchor | null = null   // anchor held back while no offset is known

  function flush() {
    if (!pending) return
    const state = pending
    pending = null
    deliver?.(state)
  }

  const transportClock = {
    get synced() { return clock.synced },
    /** The offset currently applied, in ms; null until a ping lands. */
    get offset() { return clock.offset },
    get hasPending() { return pending !== null },
    /**
     * Round trip of the best sample the estimate rests on — the offset is never
     * wrong by more than half this. Null before any sample. What a client
     * reports when the room asks for a clock resync.
     */
    get rtt() { return clock.rtt },

    /** Fold in one completed ping. */
    addSample(ping: ClockPing): SampleOutcome {
      const outcome = clock.addSample(ping)
      // The first sample releases a held anchor straight away: a rough offset
      // beats none, and because anchors are read at use time, the joiner
      // tightens up as better samples arrive without anything being re-sent.
      if (outcome === 'first') flush()
      return outcome
    },

    /**
     * End of a burst. Releases a held anchor even if no ping ever answered —
     * a burst that produced nothing has no better answer coming, and a
     * stranded anchor means a client that never plays.
     */
    settle(): void {
      flush()
    },

    /** The server's clock right now; null until measured. */
    now: (): number | null => clock.now(),

    /** The server's clock right now; our own clock while no offset is known. */
    serverNow(): number {
      return clock.now() ?? now()
    },

    /**
     * Take an anchor from the server. Delivered immediately once the clock is
     * known, otherwise held — only the newest is kept, since an older anchor
     * describes the same transport less recently.
     */
    accept(state: PlayheadAnchor): boolean {
      if (!clock.synced) { pending = state; return false }
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

  return transportClock satisfies ServerClock
}
