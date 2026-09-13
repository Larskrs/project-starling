/**
 * This process's estimate of the server's clock.
 *
 * Every playhead position is `anchor.frame + (serverNow − anchor.at) × fps`, and
 * `anchor.at` is a reading of the SERVER's clock — so a cut can only land on its
 * frame if this process knows what time it is over there. It cannot read that
 * clock, so it estimates it: our own monotonic clock plus a measured offset.
 *
 * Pure: no socket, no timers. Deciding when to ping is clockSync.ts's job, and
 * the rules below are pinned down in serverClock.test.ts. The algorithm and the
 * constants match the web editor's; docs/integrations/timing.md explains each.
 */

/** One completed `time:ping` round trip. */
export interface ClockPing {
  /** Local monotonic ms when the ping was sent. */
  t0: number;
  /** Local monotonic ms when the reply landed. */
  t2: number;
  /** The server's clock reading, from the reply. */
  serverNow: number;
}

/**
 * What a sample did to the estimate:
 * - `first`   the clock is synced for the first time;
 * - `jump`    it contradicted older samples, so a clock stood still or restarted,
 *             and the estimate moved at once;
 * - `step`    the estimate moved by more than STEP_MS, at once;
 * - `refine`  a small correction, glided towards;
 * - `ignored` the reply was unusable.
 */
export type SampleOutcome = 'first' | 'jump' | 'step' | 'refine' | 'ignored';

export interface ServerClock {
  addSample(ping: ClockPing): SampleOutcome;
  /** False until a ping has answered. Nothing should be timed before that. */
  readonly synced: boolean;
  /** serverNow − localNow as currently applied, in ms; null until synced. */
  readonly offset: number | null;
  /** Round trip of the sample the estimate rests on. The offset is good to half this. */
  readonly rtt: number | null;
  /** The server's clock right now; null until synced — never a guess. */
  now(): number | null;
}

/**
 * A clock that only counts forward. Readings look like epoch ms, but a wall
 * clock correction (NTP, someone setting the time) cannot move them — which is
 * the whole point: such a correction would move our side of the offset without
 * moving the server's.
 */
export function monotonicNow(): number {
  return performance.timeOrigin + performance.now();
}

interface Sample {
  offset: number;
  rtt: number;
  /** Local ms the sample was taken, for ageing it out. */
  at: number;
}

// The two clocks tick at slightly different rates, so a sample slowly stops
// being true. Two minutes costs a few ms at worst.
const MAX_SAMPLE_AGE_MS = 120_000;
const MAX_SAMPLES       = 24;
// Allowance on the consistency check for timer granularity and that drift.
const CONSISTENCY_SLACK_MS = 10;
// Moves bigger than a frame (at 25fps) are taken at once; smaller ones glide,
// so a routine re-sync never makes a cut fire twice or a timecode flicker.
const STEP_MS       = 40;
const SLEW_MS_PER_S = 5;

export function createServerClock({ now: localNow = monotonicNow }: { now?: () => number } = {}): ServerClock {
  let samples: Sample[] = [];
  let bestRtt: number | null = null;

  // The applied offset glides from `from`, as of local time `since`, towards
  // `target`. `target` is null until the first ping lands.
  let target: number | null = null;
  let from  = 0;
  let since = 0;

  function offsetAt(t: number): number | null {
    if (target === null) return null;
    const room = (SLEW_MS_PER_S * Math.max(0, t - since)) / 1000;
    return from + Math.max(-room, Math.min(room, target - from));
  }

  return {
    get synced() { return target !== null; },
    get offset() { return offsetAt(localNow()); },
    get rtt() { return bestRtt; },

    now() {
      const t = localNow();
      const offset = offsetAt(t);
      return offset === null ? null : t + offset;
    },

    /**
     * The server read its clock somewhere between our t0 and t2, so the true
     * offset lies in [serverNow − t2, serverNow − t0] — a bound, not an
     * assumption about the network. The midpoint is the estimate and rtt/2 its
     * worst-case error, which is why the lowest round trip in the window wins:
     * latency only ever adds, and a slow ping is slow because it queued, usually
     * in one direction. Averaging would mix that into the clean samples.
     *
     * The same bound catches a clock that moved. Two samples from continuous
     * clocks must overlap; when a new one does not overlap an older one, the
     * older one describes a relationship that no longer exists and goes —
     * otherwise its better round trip would outvote the truth.
     */
    addSample({ t0, t2, serverNow }) {
      if (![t0, t2, serverNow].every(Number.isFinite)) return 'ignored';
      const rtt = t2 - t0;
      if (rtt < 0) return 'ignored';

      const sample: Sample = { offset: serverNow + rtt / 2 - t2, rtt, at: t2 };
      const fresh = samples.filter(s => sample.at - s.at <= MAX_SAMPLE_AGE_MS);
      const agree = fresh.filter(s =>
        Math.abs(s.offset - sample.offset) <= (s.rtt + sample.rtt) / 2 + CONSISTENCY_SLACK_MS);
      samples = [...agree, sample].slice(-MAX_SAMPLES);

      const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
      bestRtt = best.rtt;

      const t       = localNow();
      const current = offsetAt(t);
      const outcome: SampleOutcome =
        current === null                                ? 'first'
        : agree.length < fresh.length                   ? 'jump'
        : Math.abs(best.offset - current) > STEP_MS     ? 'step'
        : 'refine';

      from   = outcome === 'refine' ? current! : best.offset;
      since  = t;
      target = best.offset;
      return outcome;
    },
  };
}
