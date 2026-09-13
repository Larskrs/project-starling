/**
 * The server's clock, estimated from `time:ping` round trips on a monotonic local
 * clock. The fastest recent sample wins. A sample that contradicts older ones
 * means a clock jumped, and is believed at once. Small corrections glide.
 */

export interface ClockPing {
  t0: number;
  t2: number;
  serverNow: number;
}

export type SampleOutcome = 'first' | 'jump' | 'step' | 'refine' | 'ignored';

export interface ServerClock {
  addSample(ping: ClockPing): SampleOutcome;
  readonly synced: boolean;
  /** serverNow − localNow in ms; null until synced. */
  readonly offset: number | null;
  /** Round trip of the best sample. The offset is good to half this. */
  readonly rtt: number | null;
  /** The server's clock now; null until synced. */
  now(): number | null;
}

interface Sample {
  offset: number;
  rtt: number;
  at: number;
}

const MAX_SAMPLE_AGE_MS = 120_000;
const MAX_SAMPLES = 24;
const CONSISTENCY_SLACK_MS = 10;
const STEP_MS = 40;
const SLEW_MS_PER_S = 5;

export function monotonicNow(): number {
  return performance.timeOrigin + performance.now();
}

export function createServerClock({ now: localNow = monotonicNow }: { now?: () => number } = {}): ServerClock {
  let samples: Sample[] = [];
  let bestRtt: number | null = null;
  let target: number | null = null;
  let from = 0;
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

    addSample({ t0, t2, serverNow }) {
      if (![t0, t2, serverNow].every(Number.isFinite)) return 'ignored';
      const rtt = t2 - t0;
      if (rtt < 0) return 'ignored';

      // The server read its clock between t0 and t2, so this is right to within ±rtt/2.
      const sample: Sample = { offset: serverNow + rtt / 2 - t2, rtt, at: t2 };
      const fresh = samples.filter(s => sample.at - s.at <= MAX_SAMPLE_AGE_MS);
      const agree = fresh.filter(s => Math.abs(s.offset - sample.offset) <= (s.rtt + sample.rtt) / 2 + CONSISTENCY_SLACK_MS);
      samples = [...agree, sample].slice(-MAX_SAMPLES);

      const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
      bestRtt = best.rtt;

      const t = localNow();
      const current = offsetAt(t);
      const outcome: SampleOutcome =
        current === null ? 'first'
        : agree.length < fresh.length ? 'jump'
        : Math.abs(best.offset - current) > STEP_MS ? 'step'
        : 'refine';

      from = outcome === 'refine' ? current! : best.offset;
      since = t;
      target = best.offset;
      return outcome;
    },
  };
}
