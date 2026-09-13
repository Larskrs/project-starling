/**
 * Regression guard for room-wide clock resync.
 *
 *     tsx apps/api/src/lib/clockResync.test.ts
 *
 * The invariants: every client is asked and accounted for; a Play waits for the
 * run and starts exactly once, after the room hears the run ended; and nothing —
 * a silent device, a departure, a stray report — can hold the room past its
 * deadline.
 */
import type { ClockMeasureRequest, ClockSyncStatus } from '@starling/realtime';
import { createClockResyncs, type HeldPlay } from './clockResync.js';

let failed = 0;
function check(name: string, fn: () => void): void {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${(err as Error).message}`); }
}
function eq(actual: unknown, expected: unknown, what = ''): void {
  if (actual !== expected) throw new Error(`${what} expected ${String(expected)}, got ${String(actual)}`);
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

interface FakeTimer { fn: () => void; ms: number; cleared: boolean }

function harness(socketIds = ['a', 'b', 'c']) {
  let now = 10_000;
  let seq = 0;
  const measured: ClockMeasureRequest[] = [];
  const published: ClockSyncStatus[] = [];
  const released: HeldPlay[] = [];
  const order: string[] = [];
  const timers: FakeTimer[] = [];

  const resyncs = createClockResyncs({
    now: () => now,
    measure: (_room, request) => { measured.push(request); order.push('measure'); },
    publish: (_room, status) => { published.push(status); order.push(`status:${status.state}`); },
    releasePlay: (_room, play) => { released.push(play); order.push('play'); },
    deadlineMs: 4000,
    newId: () => `run-${++seq}`,
    setTimer: (fn, ms) => { const t: FakeTimer = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (handle) => { (handle as FakeTimer).cleared = true; },
  });

  return {
    resyncs, measured, published, released, order, timers,
    start: () => resyncs.start('room', { id: 'u1', name: 'Operator' },
      socketIds.map(id => ({ socketId: id, id: `user-${id}`, name: id.toUpperCase() }))),
    last: () => published.at(-1)!,
    state: (socketId: string) => published.at(-1)!.clients.find(c => c.socketId === socketId)?.state,
    /** Fires every deadline that has not been cleared. */
    expire: () => timers.filter(t => !t.cleared).forEach(t => t.fn()),
    advance: (ms: number) => { now += ms; },
  };
}

const play = (frame: number): HeldPlay => ({ frame, frameRate: 25, userId: 'u1' });

console.log('\nrunning a resync');

check('starting asks every client to measure and lists each one as waiting', () => {
  const h = harness();
  const { requestId, joined } = h.start();
  eq(joined, false, 'joined:');
  eq(h.measured.length, 1, 'measure requests:');
  eq(h.measured[0]!.requestId, requestId, 'request id:');
  eq(h.measured[0]!.deadlineMs, 4000, 'deadline:');
  eq(h.last().state, 'measuring', 'state:');
  eq(h.last().clients.length, 3, 'clients:');
  assert(h.last().clients.every(c => c.state === 'waiting'), 'a client did not start as waiting');
  eq(h.timers[0]!.ms, 4000, 'deadline timer:');
});

check('pressing again mid-run joins the run instead of starting another', () => {
  const h = harness();
  const first = h.start();
  const second = h.start();
  eq(second.requestId, first.requestId, 'request id:');
  eq(second.joined, true, 'joined:');
  eq(h.measured.length, 1, 'the room was asked to measure twice:');
});

check('the run ends the moment the last client reports', () => {
  const h = harness();
  const { requestId } = h.start();
  h.resyncs.report('room', 'a', { requestId, rtt: 20 });
  h.resyncs.report('room', 'b', { requestId, rtt: null });
  eq(h.last().state, 'measuring', 'ended early:');
  h.advance(700);
  h.resyncs.report('room', 'c', { requestId, rtt: 44 });
  eq(h.last().state, 'done', 'state:');
  eq(h.state('a'), 'synced', 'a:');
  eq(h.state('b'), 'failed', 'b (no ping answered):');
  eq(h.last().clients.find(c => c.socketId === 'c')!.rtt, 44, 'c rtt:');
  eq(h.last().finishedAt, 10_700, 'finishedAt:');
  eq(h.timers[0]!.cleared, true, 'the deadline was left armed:');
});

check('the deadline ends the run and names whoever never answered', () => {
  const h = harness();
  const { requestId } = h.start();
  h.resyncs.report('room', 'a', { requestId, rtt: 12 });
  h.expire();
  eq(h.last().state, 'done', 'state:');
  eq(h.state('a'), 'synced', 'a:');
  eq(h.state('b'), 'no-report', 'b:');
  eq(h.state('c'), 'no-report', 'c:');
});

check('reports for another run, from a stranger, or twice over change nothing', () => {
  const h = harness();
  const { requestId } = h.start();
  const before = h.published.length;
  eq(h.resyncs.report('room', 'a', { requestId: 'run-old', rtt: 5 }), false, 'foreign run:');
  eq(h.resyncs.report('room', 'zz', { requestId, rtt: 5 }), false, 'stranger:');
  eq(h.resyncs.report('room', 'a', { requestId, rtt: 5 }), true, 'first report:');
  eq(h.resyncs.report('room', 'a', { requestId, rtt: 999 }), false, 'second report:');
  eq(h.published.length, before + 1, 'status broadcasts:');
  eq(h.last().clients.find(c => c.socketId === 'a')!.rtt, 5, 'the repeat overwrote the first answer:');
});

check('a client that leaves mid-run counts as answered, so it cannot hold the room', () => {
  const h = harness();
  const { requestId } = h.start();
  h.resyncs.report('room', 'a', { requestId, rtt: 10 });
  h.resyncs.leave('room', 'b');
  eq(h.last().state, 'measuring', 'ended before c answered:');
  h.resyncs.leave('room', 'c');
  eq(h.last().state, 'done', 'state:');
  eq(h.state('b'), 'left', 'b:');
  h.resyncs.leave('room', 'a');   // after the run: nothing to do
  eq(h.state('a'), 'synced', 'a changed after the run ended:');
});

check('a room with nobody left in it to ask ends at once', () => {
  const h = harness([]);
  h.start();
  eq(h.last().state, 'done', 'state:');
});

console.log('\nholding a Play');

check('with no run going, a Play is not held', () => {
  const h = harness();
  eq(h.resyncs.holdPlay('room', play(100)), false, 'held:');
});

check('a Play mid-run waits, the newest wins, and it starts once — after the room hears the run ended', () => {
  const h = harness();
  const { requestId } = h.start();
  eq(h.resyncs.holdPlay('room', play(100)), true, 'first play held:');
  eq(h.last().playHeld, true, 'playHeld:');
  const statusCount = h.published.length;
  eq(h.resyncs.holdPlay('room', play(250)), true, 'second play held:');
  eq(h.published.length, statusCount, 'a repeat Play re-announced an unchanged status:');
  eq(h.released.length, 0, 'released before the run ended:');

  h.resyncs.report('room', 'a', { requestId, rtt: 10 });
  h.resyncs.report('room', 'b', { requestId, rtt: 10 });
  h.resyncs.report('room', 'c', { requestId, rtt: 10 });

  eq(h.released.length, 1, 'plays released:');
  eq(h.released[0]!.frame, 250, 'released frame:');
  eq(h.last().playHeld, false, 'playHeld after release:');
  const done = h.order.indexOf('status:done');
  assert(done !== -1 && done < h.order.indexOf('play'), `play started before the room heard the run end: ${h.order.join(', ')}`);
});

check('a held Play still starts when the deadline ends the run', () => {
  const h = harness();
  h.start();
  h.resyncs.holdPlay('room', play(40));
  h.expire();
  eq(h.released.length, 1, 'plays released:');
  eq(h.released[0]!.frame, 40, 'frame:');
});

check('a Pause cancels a held Play', () => {
  const h = harness();
  h.start();
  h.resyncs.holdPlay('room', play(40));
  eq(h.resyncs.cancelPlay('room'), true, 'cancelled:');
  eq(h.last().playHeld, false, 'playHeld:');
  h.expire();
  eq(h.released.length, 0, 'a cancelled Play started:');
  eq(h.resyncs.cancelPlay('room'), false, 'cancel with nothing held:');
});

console.log('\nlifecycle');

check('a new run can start once the last one has ended', () => {
  const h = harness();
  const first = h.start();
  h.expire();
  const second = h.start();
  assert(second.requestId !== first.requestId, 'reused the finished run');
  eq(second.joined, false, 'joined:');
  eq(h.measured.length, 2, 'measure requests:');
});

check('measuring() shows a joiner the run in progress, and nothing once it ends', () => {
  const h = harness();
  h.start();
  eq(h.resyncs.measuring('room')?.state, 'measuring', 'mid-run:');
  h.expire();
  eq(h.resyncs.measuring('room'), null, 'after the run:');
});

check('published statuses are copies, so later progress cannot rewrite what was sent', () => {
  const h = harness();
  const { requestId } = h.start();
  const first = h.published[0]!;
  h.resyncs.report('room', 'a', { requestId, rtt: 10 });
  eq(first.clients.find(c => c.socketId === 'a')!.state, 'waiting', 'the earlier broadcast changed:');
});

check('clearing an emptied room stops its deadline', () => {
  const h = harness();
  h.start();
  const count = h.published.length;
  h.resyncs.clear('room');
  h.expire();
  eq(h.published.length, count, 'a cleared run still reported:');
});

console.log(failed ? `\n${failed} failed\n` : '\nall passed\n');
if (failed) process.exit(1);

export {};
