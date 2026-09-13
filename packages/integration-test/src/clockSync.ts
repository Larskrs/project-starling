/**
 * When to ping.
 *
 * serverClock.ts turns round trips into an estimate; this decides when round
 * trips happen, on the schedule docs/integrations/timing.md sets out:
 *
 * - a burst on every connect — nothing is known yet, or the path changed;
 * - a burst once the transport upgrades to WebSocket, because samples taken over
 *   long-polling are lopsided. Behind a proxy that never upgrades (cino.no),
 *   polling samples are all there is, and the lowest round trip still wins;
 * - one ping every CLOCK_RESYNC_MS, so an all-night process keeps tracking;
 * - a burst when the machine looks like it slept;
 * - a fresh burst on demand, when someone presses "Sync clocks" (`measure`).
 */
import type { Socket } from 'socket.io-client';
import { TimelineEvent } from '@starling/realtime';
import { monotonicNow, type ServerClock, type SampleOutcome } from './serverClock.ts';

export const CLOCK_BURST     = 5;
export const CLOCK_GAP_MS    = 120;
export const CLOCK_RESYNC_MS = 15_000;

const PING_TIMEOUT_MS = 2_000;
const WAKE_CHECK_MS   = 2_000;
const WAKE_SLACK_MS   = 1_000;

export interface ClockSync {
  /**
   * A burst that starts after the call. One already under way began before the
   * request, so it is allowed to finish and a fresh one follows. Resolves when
   * the fresh burst is done.
   */
  measure(): Promise<void>;
  stop(): void;
}

/** A timer that must not keep the process alive by itself — the socket does that. */
function background(timer: unknown): void {
  (timer as { unref?: () => void }).unref?.();
}

export function startClockSync(
  socket: Socket,
  clock: ServerClock,
  onSample?: (outcome: SampleOutcome) => void,
): ClockSync {
  function ping(): Promise<void> {
    return new Promise((resolve) => {
      if (!socket.connected) { resolve(); return; }
      const t0 = monotonicNow();
      socket.timeout(PING_TIMEOUT_MS).emit(TimelineEvent.timePing, (err: Error | null, serverNow: number) => {
        // A lost ping is just a missing sample. Recorded BEFORE the optional
        // callback: `onSample?.(clock.addSample(…))` skips evaluating its
        // argument when there is no callback, which silently recorded nothing.
        if (!err) {
          const outcome = clock.addSample({ t0, t2: monotonicNow(), serverNow });
          onSample?.(outcome);
        }
        resolve();
      });
    });
  }

  async function runBurst(): Promise<void> {
    for (let i = 0; i < CLOCK_BURST && socket.connected; i++) {
      if (i > 0) await new Promise(r => background(setTimeout(r, CLOCK_GAP_MS)));
      await ping();
    }
  }

  // The burst under way, if any. Concurrent callers share it.
  let current: Promise<void> | null = null;

  function burst(): Promise<void> {
    current ??= runBurst().finally(() => { current = null; });
    return current;
  }

  async function measure(): Promise<void> {
    if (current) await current;
    await burst();
  }

  const onConnect = () => {
    void burst();
    // Each connection gets a fresh engine, which starts on long-polling.
    const engine = socket.io.engine;
    if (engine && engine.transport?.name !== 'websocket') engine.once('upgrade', () => void burst());
  };
  socket.on('connect', onConnect);

  const resync = setInterval(() => { if (!current) void ping(); }, CLOCK_RESYNC_MS);
  background(resync);

  // Sleep detection. Node's monotonic clock does not count time suspended on
  // Linux or macOS, so after a lid opens the offset is wrong by the length of
  // the nap. The wall clock does count it — so when the two disagree about how
  // long this interval took, something stood still. The wall clock is only a
  // tripwire here and never measures anything; an NTP step also trips it,
  // which costs one harmless burst.
  let wall = Date.now();
  let mono = monotonicNow();
  const wake = setInterval(() => {
    const nextWall = Date.now();
    const nextMono = monotonicNow();
    const disagreement = (nextWall - wall) - (nextMono - mono);
    wall = nextWall;
    mono = nextMono;
    if (Math.abs(disagreement) > WAKE_SLACK_MS) void burst();
  }, WAKE_CHECK_MS);
  background(wake);

  return {
    measure,
    stop() {
      socket.off('connect', onConnect);
      clearInterval(resync);
      clearInterval(wake);
    },
  };
}
