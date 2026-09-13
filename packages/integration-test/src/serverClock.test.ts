/**
 * Regression guard for the server clock estimate.
 *
 *     node packages/integration-test/src/serverClock.test.ts
 *
 * (Standalone, same convention as the other tests here. Exits non-zero on
 * failure.)
 *
 * The invariants: no time before a ping has answered, the fastest round trip
 * decides, small corrections glide and big ones do not, and a clock that jumped
 * (a laptop that slept, an API that restarted) is believed at once.
 */
import { createServerClock } from './serverClock.ts';

let failed = 0;
function check(name: string, fn: () => void): void {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${(err as Error).message}`); }
}
function eq(actual: unknown, expected: unknown, what = ''): void {
  if (actual !== expected) throw new Error(`${what} expected ${String(expected)}, got ${String(actual)}`);
}
function close(actual: number | null, expected: number, tolerance: number, what = ''): void {
  if (actual === null || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${what} expected ≈${expected}, got ${String(actual)}`);
  }
}

// The server's clock runs 30s ahead of ours, so nothing passes by assuming the
// two agree.
const SKEW  = 30_000;
const START = 1_000_000;

function localClock() {
  let t = START;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

/**
 * A round trip of `rtt` ms sent at local `sendAt`, against a server `skew` ms
 * ahead. `outbound` is the part of the trip spent on the way there; the
 * estimate assumes half, so anything else skews it by `outbound − rtt/2`.
 */
const ping = (sendAt: number, rtt: number, outbound = rtt / 2, skew = SKEW) =>
  ({ t0: sendAt, t2: sendAt + rtt, serverNow: sendAt + outbound + skew });

console.log('\nmeasuring');

check('there is no server time until a ping has answered', () => {
  const clock = createServerClock(localClock());
  eq(clock.synced, false, 'synced:');
  eq(clock.now(), null, 'now():');
  eq(clock.offset, null, 'offset:');
});

check('a symmetric round trip measures the skew exactly', () => {
  const local = localClock();
  const clock = createServerClock(local);
  eq(clock.addSample(ping(START - 40, 40)), 'first', 'outcome:');
  close(clock.offset, SKEW, 0.001, 'offset:');
  close(clock.now(), START + SKEW, 0.001, 'now():');
  eq(clock.rtt, 40, 'rtt:');
});

check('the error never exceeds half the round trip, however lopsided the trip', () => {
  for (const outbound of [0, 100, 400]) {
    const clock = createServerClock(localClock());
    clock.addSample(ping(START - 400, 400, outbound));
    close(clock.offset, SKEW, 200, `outbound ${outbound}ms:`);
  }
});

check('the lowest round trip wins, whatever order samples arrive in', () => {
  const clock = createServerClock(localClock());
  clock.addSample(ping(START - 300, 300, 250));   // queued on the way out
  clock.addSample(ping(START - 20, 20));          // clean
  clock.addSample(ping(START - 90, 90, 80));      // later, but slower
  close(clock.offset, SKEW, 0.001, 'offset:');
  eq(clock.rtt, 20, 'rtt:');
});

check('nonsense replies are ignored', () => {
  const clock = createServerClock(localClock());
  eq(clock.addSample({ t0: START, t2: START + 10, serverNow: Number.NaN }), 'ignored', 'NaN:');
  eq(clock.addSample({ t0: START, t2: START - 10, serverNow: START }), 'ignored', 'negative rtt:');
  eq(clock.synced, false, 'synced:');
});

console.log('\ncorrecting');

check('a small correction glides at 5ms per second', () => {
  const local = localClock();
  const clock = createServerClock(local);

  clock.addSample(ping(START - 30, 30, 5, SKEW + 10));            // lopsided: reads SKEW
  close(clock.offset, SKEW, 0.001, 'fixture:');

  local.advance(1000);
  eq(clock.addSample(ping(local.now() - 10, 10, 5, SKEW + 10)), 'refine', 'outcome:');
  close(clock.offset, SKEW, 0.001, 'right after:');

  local.advance(1000);
  close(clock.offset, SKEW + 5, 0.001, 'one second on:');

  local.advance(5000);
  close(clock.offset, SKEW + 10, 0.001, 'settled:');
});

check('a correction bigger than a frame is taken at once', () => {
  const clock = createServerClock(localClock());
  clock.addSample(ping(START - 400, 400, 360));                   // 160ms off
  eq(clock.addSample(ping(START - 20, 20)), 'step', 'outcome:');
  close(clock.offset, SKEW, 0.001, 'offset:');
});

check('a clock that jumped outvotes older samples with better round trips', () => {
  // Our monotonic clock stood still for 5s while the machine slept, so the
  // server is 5s further ahead. The new sample is slower and would lose on
  // round trip alone.
  const local = localClock();
  const clock = createServerClock(local);
  clock.addSample(ping(START - 10, 10));
  local.advance(1000);
  eq(clock.addSample(ping(local.now() - 80, 80, 40, SKEW + 5000)), 'jump', 'outcome:');
  close(clock.offset, SKEW + 5000, 0.001, 'offset:');
});

check('samples older than two minutes stop counting', () => {
  const local = localClock();
  const clock = createServerClock(local);
  clock.addSample(ping(START - 5, 5));                            // excellent, soon stale
  local.advance(121_000);
  clock.addSample(ping(local.now() - 50, 50, 25, SKEW + 20));
  local.advance(5000);
  close(clock.offset, SKEW + 20, 0.001, 'offset:');
  eq(clock.rtt, 50, 'rtt:');
});

console.log(failed ? `\n${failed} failed\n` : '\nall passed\n');
if (failed) process.exit(1);

export {};
