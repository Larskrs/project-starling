import type { Socket } from 'socket.io-client';
import { TimelineEvent } from '../protocol.ts';
import { monotonicNow, type SampleOutcome, type ServerClock } from './serverClock.ts';

export const CLOCK_BURST = 5;
export const CLOCK_GAP_MS = 120;
export const CLOCK_RESYNC_MS = 15_000;

const PING_TIMEOUT_MS = 2_000;
const WAKE_CHECK_MS = 2_000;
const WAKE_SLACK_MS = 1_000;

export interface ClockSync {
  /** A burst that starts after the call. One already running is waited out first. */
  measure(): Promise<void>;
  /** Resolves once no burst is running, without starting one. */
  idle(): Promise<void>;
  stop(): void;
}

const background = (timer: unknown) => (timer as { unref?: () => void }).unref?.();

/** Pings in a burst on connect, after the WebSocket upgrade and on wake, then once every 15 seconds. */
export function startClockSync(socket: Socket, clock: ServerClock, onSample?: (outcome: SampleOutcome) => void): ClockSync {
  let current: Promise<void> | null = null;

  function ping(): Promise<void> {
    return new Promise((resolve) => {
      if (!socket.connected) { resolve(); return; }
      const t0 = monotonicNow();
      socket.timeout(PING_TIMEOUT_MS).emit(TimelineEvent.timePing, (err: Error | null, serverNow: number) => {
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
      if (i > 0) await new Promise(resolve => background(setTimeout(resolve, CLOCK_GAP_MS)));
      await ping();
    }
  }

  function burst(): Promise<void> {
    current ??= runBurst().finally(() => { current = null; });
    return current;
  }

  const onConnect = () => {
    void burst();
    const engine = socket.io.engine;
    if (engine && engine.transport?.name !== 'websocket') engine.once('upgrade', () => void burst());
  };
  socket.on('connect', onConnect);

  const resync = setInterval(() => { if (!current) void ping(); }, CLOCK_RESYNC_MS);
  background(resync);

  // A monotonic clock stops while the machine sleeps; the wall clock does not.
  let wall = Date.now();
  let mono = monotonicNow();
  const wake = setInterval(() => {
    const nextWall = Date.now();
    const nextMono = monotonicNow();
    const drift = (nextWall - wall) - (nextMono - mono);
    wall = nextWall;
    mono = nextMono;
    if (Math.abs(drift) > WAKE_SLACK_MS) void burst();
  }, WAKE_CHECK_MS);
  background(wake);

  return {
    async measure() {
      if (current) await current;
      await burst();
    },
    async idle() {
      while (current) await current;
    },
    stop() {
      socket.off('connect', onConnect);
      clearInterval(resync);
      clearInterval(wake);
    },
  };
}
