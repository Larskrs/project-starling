import { createServerClock } from '../src/clock/serverClock.ts';
import { check, eq, finish, near, section } from './harness.ts';

const SKEW  = 30_000;
const START = 1_000_000;

function localClock() {
  let t = START;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

/** A round trip of `rtt` ms sent at `sendAt`; `outbound` is the part spent on the way there. */
const ping = (sendAt: number, rtt: number, outbound = rtt / 2, skew = SKEW) =>
  ({ t0: sendAt, t2: sendAt + rtt, serverNow: sendAt + outbound + skew });

section('measuring');

await check('there is no server time until a ping has answered', () => {
  const clock = createServerClock(localClock());
  eq(clock.synced, false, 'synced:');
  eq(clock.now(), null, 'now():');
  eq(clock.offset, null, 'offset:');
});

await check('a symmetric round trip measures the skew exactly', () => {
  const clock = createServerClock(localClock());
  eq(clock.addSample(ping(START - 40, 40)), 'first', 'outcome:');
  near(clock.offset, SKEW, 0.001, 'offset:');
  near(clock.now(), START + SKEW, 0.001, 'now():');
  eq(clock.rtt, 40, 'rtt:');
});

await check('the error never exceeds half the round trip', () => {
  for (const outbound of [0, 100, 400]) {
    const clock = createServerClock(localClock());
    clock.addSample(ping(START - 400, 400, outbound));
    near(clock.offset, SKEW, 200, `outbound ${outbound}ms:`);
  }
});

await check('the lowest round trip wins, in any order', () => {
  const clock = createServerClock(localClock());
  clock.addSample(ping(START - 300, 300, 250));
  clock.addSample(ping(START - 20, 20));
  clock.addSample(ping(START - 90, 90, 80));
  near(clock.offset, SKEW, 0.001, 'offset:');
  eq(clock.rtt, 20, 'rtt:');
});

await check('nonsense replies are ignored', () => {
  const clock = createServerClock(localClock());
  eq(clock.addSample({ t0: START, t2: START + 10, serverNow: Number.NaN }), 'ignored', 'NaN:');
  eq(clock.addSample({ t0: START, t2: START - 10, serverNow: START }), 'ignored', 'negative rtt:');
  eq(clock.synced, false, 'synced:');
});

section('correcting');

await check('a small correction glides at 5ms per second', () => {
  const local = localClock();
  const clock = createServerClock(local);
  clock.addSample(ping(START - 30, 30, 5, SKEW + 10));
  near(clock.offset, SKEW, 0.001, 'fixture:');
  local.advance(1000);
  eq(clock.addSample(ping(local.now() - 10, 10, 5, SKEW + 10)), 'refine', 'outcome:');
  near(clock.offset, SKEW, 0.001, 'right after:');
  local.advance(1000);
  near(clock.offset, SKEW + 5, 0.001, 'one second on:');
  local.advance(5000);
  near(clock.offset, SKEW + 10, 0.001, 'settled:');
});

await check('a correction bigger than a frame is taken at once', () => {
  const clock = createServerClock(localClock());
  clock.addSample(ping(START - 400, 400, 360));
  eq(clock.addSample(ping(START - 20, 20)), 'step', 'outcome:');
  near(clock.offset, SKEW, 0.001, 'offset:');
});

await check('a clock that jumped outvotes older samples with better round trips', () => {
  const local = localClock();
  const clock = createServerClock(local);
  clock.addSample(ping(START - 10, 10));
  local.advance(1000);
  eq(clock.addSample(ping(local.now() - 80, 80, 40, SKEW + 5000)), 'jump', 'outcome:');
  near(clock.offset, SKEW + 5000, 0.001, 'offset:');
});

await check('samples older than two minutes stop counting', () => {
  const local = localClock();
  const clock = createServerClock(local);
  clock.addSample(ping(START - 5, 5));
  local.advance(121_000);
  clock.addSample(ping(local.now() - 50, 50, 25, SKEW + 20));
  local.advance(5000);
  near(clock.offset, SKEW + 20, 0.001, 'offset:');
  eq(clock.rtt, 50, 'rtt:');
});

finish();
