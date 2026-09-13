import { CLOCK_BURST, startClockSync } from '../src/clock/clockSync.ts';
import { createServerClock } from '../src/clock/serverClock.ts';
import { fakeSocket } from './fakes.ts';
import { check, eq, finish, section } from './harness.ts';

function connected(options?: Parameters<typeof fakeSocket>[0]) {
  const fake = fakeSocket(options);
  fake.raw.connected = true;
  return fake;
}

section('measuring on request');

await check('with nothing under way, measure runs exactly one burst', async () => {
  const fake = connected();
  const clock = createServerClock();
  const sync = startClockSync(fake.socket, clock);
  try {
    await sync.measure();
    eq(fake.pingTimes.length, CLOCK_BURST, 'pings:');
    eq(clock.synced, true, 'synced:');
    eq(clock.rtt !== null, true, 'rtt measured:');
  } finally {
    sync.stop();
  }
});

await check('during a burst, measure waits for it and then runs a fresh one', async () => {
  const fake = connected();
  const clock = createServerClock();
  const sync = startClockSync(fake.socket, clock);
  try {
    fake.fire('connect');
    const requestedAt = performance.now();
    await sync.measure();
    eq(fake.pingTimes.length, 2 * CLOCK_BURST, 'pings:');
    eq(fake.pingTimes.slice(CLOCK_BURST).every(t => t >= requestedAt), true, 'the fresh burst started after the request:');
  } finally {
    sync.stop();
  }
});

await check('when no ping is answered, measure still resolves and the clock stays unsynced', async () => {
  const fake = connected({ answersPings: false });
  const clock = createServerClock();
  const sync = startClockSync(fake.socket, clock);
  try {
    await sync.measure();
    eq(fake.pingTimes.length, CLOCK_BURST, 'pings:');
    eq(clock.synced, false, 'synced:');
    eq(clock.rtt, null, 'rtt:');
  } finally {
    sync.stop();
  }
});

await check('a socket that is not connected is not pinged, and measure does not hang', async () => {
  const fake = fakeSocket();
  const clock = createServerClock();
  const sync = startClockSync(fake.socket, clock);
  try {
    await sync.measure();
    eq(fake.pingTimes.length, 0, 'pings:');
  } finally {
    sync.stop();
  }
});

finish();
