/**
 * Regression guard for the integration's side of a room-wide clock sync.
 *
 *     node packages/integration-test/src/resync.test.ts
 *
 * (Standalone, same convention as the other tests here. Exits non-zero on
 * failure.)
 *
 * The invariants: a report describes a measurement made AFTER the request; a
 * client that could not measure says so rather than guessing; and the terminal
 * gets one line per thing an operator needs to know, not one per status update.
 */
import type { ClockClientStatus, ClockSyncStatus } from '@starling/realtime';
import { answerMeasure, createClockStatusWatch, describeClient, isWithinFrame } from './resync.ts';

let failed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${(err as Error).message}`); }
}
function eq(actual: unknown, expected: unknown, what = ''): void {
  if (actual !== expected) throw new Error(`${what} expected ${String(expected)}, got ${String(actual)}`);
}

const FPS = 25;   // a frame is 40ms, so ±40ms is the loosest that still counts

const client = (socketId: string, state: ClockClientStatus['state'], rtt: number | null = null): ClockClientStatus =>
  ({ socketId, id: `token:${socketId}`, name: socketId.toUpperCase(), state, rtt });

const status = (over: Partial<ClockSyncStatus> = {}): ClockSyncStatus => ({
  requestId:   'run-1',
  state:       'measuring',
  requestedBy: { id: 'u1', name: 'Stage manager' },
  startedAt:   1000,
  finishedAt:  null,
  deadlineMs:  4000,
  playHeld:    false,
  clients:     [client('a', 'waiting'), client('b', 'waiting')],
  ...over,
});

console.log('\nanswering');

await check('the report is read after the fresh burst, not before', async () => {
  let rtt: number | null = 400;   // a stale, loose estimate from before the request
  const clock = {
    measure: async () => { await new Promise(r => setTimeout(r, 5)); rtt = 18; },
    get rtt() { return rtt; },
  };
  const report = await answerMeasure({ requestId: 'run-7', deadlineMs: 4000 }, clock);
  eq(report.requestId, 'run-7', 'requestId:');
  eq(report.rtt, 18, 'rtt:');
});

await check('a clock that got no ping through reports null, never a guess', async () => {
  const report = await answerMeasure({ requestId: 'run-7', deadlineMs: 4000 }, { measure: async () => {}, rtt: null });
  eq(report.rtt, null, 'rtt:');
});

console.log('\ndescribing a client');

await check('within a frame means measured, with no more than half a frame of error', () => {
  eq(isWithinFrame(client('a', 'synced', 80), FPS), true, '±40ms at 25fps:');
  eq(isWithinFrame(client('a', 'synced', 82), FPS), false, '±41ms at 25fps:');
  eq(isWithinFrame(client('a', 'failed'), FPS), false, 'failed:');
  eq(isWithinFrame(client('a', 'no-report'), FPS), false, 'no report:');
});

await check('each state reads the way the editor panel says it', () => {
  eq(describeClient(client('a', 'synced', 18), FPS), '±9 ms', 'synced:');
  eq(describeClient(client('a', 'synced', 120), FPS), '±60 ms, looser than a frame', 'loose:');
  eq(describeClient(client('a', 'synced', 0), FPS), '±1 ms', 'never claims zero error:');
  eq(describeClient(client('a', 'failed'), FPS), 'no ping got through', 'failed:');
  eq(describeClient(client('a', 'no-report'), FPS), 'did not answer', 'no report:');
  eq(describeClient(client('a', 'left'), FPS), 'left the timeline', 'left:');
});

console.log('\nwatching a run');

await check('a run is announced once, however many updates it sends', () => {
  const watch = createClockStatusWatch(() => FPS);
  const first = watch.observe(status());
  eq(first.length, 1, 'lines:');
  eq(first[0]!.text, 'clock sync started by Stage manager', 'text:');
  eq(watch.observe(status({ clients: [client('a', 'synced', 10), client('b', 'waiting')] })).length, 0, 'a client answering:');
});

await check('a held Play is announced once, when it starts waiting', () => {
  const watch = createClockStatusWatch(() => FPS);
  watch.observe(status());
  const held = watch.observe(status({ playHeld: true }));
  eq(held.length, 1, 'lines:');
  eq(held[0]!.level, 'warn', 'level:');
  eq(watch.observe(status({ playHeld: true })).length, 0, 'repeated:');
});

await check('the end names every client that is not within a frame, and nobody else', () => {
  const watch = createClockStatusWatch(() => FPS);
  watch.observe(status());
  const lines = watch.observe(status({
    state: 'done',
    clients: [
      client('mixer', 'synced', 20),
      client('desk', 'synced', 150),
      client('tally', 'no-report'),
      client('laptop', 'left'),
    ],
  }));
  eq(lines[0]!.text, 'clock sync done: 1/4 within a frame', 'summary:');
  eq(lines[0]!.level, 'warn', 'summary level:');
  eq(lines.length, 4, 'lines (summary + three not within a frame):');
  eq(lines.some(l => l.text.includes('MIXER')), false, 'listed a client that was fine:');
  eq(lines[1]!.text, '  DESK: ±75 ms, looser than a frame', 'desk:');
});

await check('a clean run ends on one ok line, and is not repeated', () => {
  const watch = createClockStatusWatch(() => FPS);
  watch.observe(status());
  const done = status({ state: 'done', clients: [client('a', 'synced', 10), client('b', 'synced', 30)] });
  const lines = watch.observe(done);
  eq(lines.length, 1, 'lines:');
  eq(lines[0]!.level, 'ok', 'level:');
  eq(lines[0]!.text, 'clock sync done: 2/2 within a frame', 'text:');
  eq(watch.observe(done).length, 0, 'repeated done:');
});

await check('joining mid-run announces it, and the next run is announced again', () => {
  const watch = createClockStatusWatch(() => FPS);
  eq(watch.observe(status({ requestId: 'run-9', playHeld: true })).length, 2, 'joined a run with a Play held:');
  watch.observe(status({ requestId: 'run-9', state: 'done', clients: [] }));
  eq(watch.observe(status({ requestId: 'run-10' }))[0]?.text, 'clock sync started by Stage manager', 'next run:');
});

console.log(failed ? `\n${failed} failed\n` : '\nall passed\n');
if (failed) process.exit(1);

export {};
