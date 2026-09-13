import { answerMeasure, createClockStatusWatch, describeClient, isWithinFrame } from '../src/clock/resync.ts';
import type { ClockClientStatus, ClockSyncStatus } from '../src/protocol.ts';
import { check, eq, finish, section } from './harness.ts';

const FPS = 25;

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

section('answering');

await check('the report is read after the fresh burst, not before', async () => {
  let rtt: number | null = 400;
  const clock = {
    measure: async () => { await new Promise(r => setTimeout(r, 5)); rtt = 18; },
    get rtt() { return rtt; },
  };
  const report = await answerMeasure({ requestId: 'run-7', deadlineMs: 4000 }, clock);
  eq(report.requestId, 'run-7', 'requestId:');
  eq(report.rtt, 18, 'rtt:');
});

await check('a clock that got no ping through reports null', async () => {
  const report = await answerMeasure({ requestId: 'run-7', deadlineMs: 4000 }, { measure: async () => {}, rtt: null });
  eq(report.rtt, null, 'rtt:');
});

section('describing a client');

await check('within a frame means measured, with at most half a frame of error', () => {
  eq(isWithinFrame(client('a', 'synced', 80), FPS), true, '±40ms at 25fps:');
  eq(isWithinFrame(client('a', 'synced', 82), FPS), false, '±41ms at 25fps:');
  eq(isWithinFrame(client('a', 'failed'), FPS), false, 'failed:');
  eq(isWithinFrame(client('a', 'no-report'), FPS), false, 'no report:');
});

await check('each state reads the way the editor panel says it', () => {
  eq(describeClient(client('a', 'synced', 18), FPS), '±9 ms', 'synced:');
  eq(describeClient(client('a', 'synced', 120), FPS), '±60 ms, looser than a frame', 'loose:');
  eq(describeClient(client('a', 'synced', 0), FPS), '±1 ms', 'never zero:');
  eq(describeClient(client('a', 'failed'), FPS), 'no ping got through', 'failed:');
  eq(describeClient(client('a', 'no-report'), FPS), 'did not answer', 'no report:');
  eq(describeClient(client('a', 'left'), FPS), 'left the timeline', 'left:');
});

section('watching a run');

await check('a run is announced once, however many updates it sends', () => {
  const watch = createClockStatusWatch(() => FPS);
  const first = watch.observe(status());
  eq(first.length, 1, 'lines:');
  eq(first[0]!.text, 'clock sync started by Stage manager', 'text:');
  eq(watch.observe(status({ clients: [client('a', 'synced', 10), client('b', 'waiting')] })).length, 0, 'a client answering:');
});

await check('a held Play is announced once', () => {
  const watch = createClockStatusWatch(() => FPS);
  watch.observe(status());
  const held = watch.observe(status({ playHeld: true }));
  eq(held.length, 1, 'lines:');
  eq(held[0]!.level, 'warn', 'level:');
  eq(watch.observe(status({ playHeld: true })).length, 0, 'repeated:');
});

await check('the end names every client not within a frame, and nobody else', () => {
  const watch = createClockStatusWatch(() => FPS);
  watch.observe(status());
  const lines = watch.observe(status({
    state: 'done',
    clients: [client('mixer', 'synced', 20), client('desk', 'synced', 150), client('tally', 'no-report'), client('laptop', 'left')],
  }));
  eq(lines[0]!.text, 'clock sync done: 1/4 within a frame', 'summary:');
  eq(lines.length, 4, 'lines:');
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
  eq(watch.observe(done).length, 0, 'repeated:');
});

await check('joining mid-run announces it, and the next run is announced again', () => {
  const watch = createClockStatusWatch(() => FPS);
  eq(watch.observe(status({ requestId: 'run-9', playHeld: true })).length, 2, 'joined with Play held:');
  watch.observe(status({ requestId: 'run-9', state: 'done', clients: [] }));
  eq(watch.observe(status({ requestId: 'run-10' }))[0]?.text, 'clock sync started by Stage manager', 'next run:');
});

finish();
