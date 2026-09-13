/**
 * Regression guard for when the integration pings, against a fake socket.
 *
 *     node packages/integration-test/src/clockSync.test.ts
 *
 * (Standalone, same convention as the other tests here. Exits non-zero on
 * failure. Takes about two seconds: bursts really wait 120ms between pings.)
 *
 * The invariant that matters for "Sync clocks": `measure()` resolves only after
 * a burst that STARTED after it was called. A burst already under way began
 * before anyone asked, so answering the moment it finishes would report an
 * estimate the request was meant to refresh.
 */
import type { Socket } from 'socket.io-client';
import { CLOCK_BURST, startClockSync } from './clockSync.ts';
import { createServerClock } from './serverClock.ts';

// clockSync unrefs its timers so that on a real device they never keep the
// process alive on their own — the socket does that. A fake socket holds nothing
// open, so without this the process would exit between pings, mid-await.
const keepAlive = setInterval(() => {}, 1000);

let failed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${(err as Error).message}`); }
}
function eq(actual: unknown, expected: unknown, what = ''): void {
  if (actual !== expected) throw new Error(`${what} expected ${String(expected)}, got ${String(actual)}`);
}

/** Enough of a socket.io client for clockSync: `connect`, and acked `time:ping`s. */
function fakeSocket({ answers = true } = {}) {
  const handlers = new Map<string, Array<() => void>>();
  const sentAt: number[] = [];
  const socket = {
    connected: true,
    io: { engine: { transport: { name: 'websocket' }, once: () => {} } },
    on(event: string, fn: () => void) { handlers.set(event, [...(handlers.get(event) ?? []), fn]); return socket; },
    off() { return socket; },
    timeout() {
      return {
        emit(_event: string, ack: (err: Error | null, serverNow?: number) => void) {
          sentAt.push(performance.now());
          // A server 5s ahead that answers in about 2ms — or, with answers off, never does.
          setTimeout(() => answers
            ? ack(null, performance.timeOrigin + performance.now() + 5000)
            : ack(new Error('operation has timed out')), 2);
        },
      };
    },
  };
  return {
    socket: socket as unknown as Socket,
    sentAt,
    fire: (event: string) => handlers.get(event)?.forEach(fn => fn()),
  };
}

console.log('\nmeasuring on request');

await check('with nothing under way, measure runs exactly one burst', async () => {
  const fake  = fakeSocket();
  const clock = createServerClock();
  const sync  = startClockSync(fake.socket, clock);
  try {
    await sync.measure();
    eq(fake.sentAt.length, CLOCK_BURST, 'pings:');
    eq(clock.synced, true, 'synced:');
    eq(clock.rtt !== null, true, 'rtt measured:');
  } finally {
    sync.stop();
  }
});

await check('during a burst, measure waits for it and then runs a fresh one', async () => {
  const fake  = fakeSocket();
  const clock = createServerClock();
  const sync  = startClockSync(fake.socket, clock);
  try {
    fake.fire('connect');                  // the connect burst starts
    const requestedAt = performance.now(); // …and then someone presses Sync clocks
    await sync.measure();
    eq(fake.sentAt.length, 2 * CLOCK_BURST, 'pings:');
    const fresh = fake.sentAt.slice(CLOCK_BURST);
    eq(fresh.every(t => t >= requestedAt), true, 'the fresh burst sent a ping before the request:');
  } finally {
    sync.stop();
  }
});

await check('when no ping is answered, measure still resolves and the clock stays unsynced', async () => {
  const fake  = fakeSocket({ answers: false });
  const clock = createServerClock();
  const sync  = startClockSync(fake.socket, clock);
  try {
    await sync.measure();
    eq(fake.sentAt.length, CLOCK_BURST, 'pings:');
    eq(clock.synced, false, 'synced:');
    eq(clock.rtt, null, 'rtt:');
  } finally {
    sync.stop();
  }
});

await check('a socket that is not connected is not pinged, and measure does not hang', async () => {
  const fake  = fakeSocket();
  (fake.socket as unknown as { connected: boolean }).connected = false;
  const clock = createServerClock();
  const sync  = startClockSync(fake.socket, clock);
  try {
    await sync.measure();
    eq(fake.sentAt.length, 0, 'pings:');
  } finally {
    sync.stop();
  }
});

clearInterval(keepAlive);
console.log(failed ? `\n${failed} failed\n` : '\nall passed\n');
if (failed) process.exit(1);

export {};
