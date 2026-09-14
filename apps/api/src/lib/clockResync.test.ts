/**
 * Regression guard for room-wide clock resync.
 *
 *     tsx apps/api/src/lib/clockResync.test.ts
 *
 * The invariants: every client is asked and accounted for; a Play waits for the
 * run and starts exactly once, after the room hears the run ended; nothing — a
 * silent device, a departure, a stray report — can hold the room past its
 * deadline; and the room is told each change once, gathered, not the whole
 * table again on every report.
 *
 * What a client sees is rebuilt through the real wire codec, so these checks
 * also hold the encoders and applyProgress to the same story.
 */
import {
  applyProgress, decodeStatus, encodeProgress, encodeStatus,
  type ClockMeasureRequest, type ClockSyncProgress, type ClockSyncStatus,
} from '@starling/realtime';
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

interface FakeTimer { fn: () => void; ms: number; cleared: boolean; fired: boolean }

const DEADLINE = 4000;
const PROGRESS = 250;

function harness(socketIds = ['a', 'b', 'c']) {
  let seq = 0;
  const measured: ClockMeasureRequest[] = [];
  const published: ClockSyncStatus[] = [];
  const progressed: ClockSyncProgress[] = [];
  const released: HeldPlay[] = [];
  const order: string[] = [];
  const timers: FakeTimer[] = [];
  /** The run as a client following the room sees it. */
  let view: ClockSyncStatus | null = null;

  const resyncs = createClockResyncs({
    measure: (_room, request) => { measured.push(request); order.push('measure'); },
    publish: (_room, status) => {
      published.push(status);
      view = decodeStatus(encodeStatus(status));
      order.push('status');
    },
    progress: (_room, update) => {
      progressed.push(update);
      view = applyProgress(view, encodeProgress(update));
      order.push(`progress:${update.state}`);
    },
    releasePlay: (_room, play) => { released.push(play); order.push('play'); },
    deadlineMs: DEADLINE,
    progressMs: PROGRESS,
    newId: () => `run-${++seq}`,
    setTimer: (fn, ms) => { const t: FakeTimer = { fn, ms, cleared: false, fired: false }; timers.push(t); return t; },
    clearTimer: (handle) => { (handle as FakeTimer).cleared = true; },
  });

  const fire = (ms: number) => timers
    .filter(t => t.ms === ms && !t.cleared && !t.fired)
    .forEach((t) => { t.fired = true; t.fn(); });

  return {
    resyncs, measured, published, progressed, released, order, timers,
    start: () => resyncs.start('room', { name: 'Operator' },
      socketIds.map(id => ({ socketId: id, id: `user-${id}`, name: id.toUpperCase() }))),
    view: () => view!,
    state: (socketId: string) => view!.clients[socketIds.indexOf(socketId)]?.state,
    rtt: (socketId: string) => view!.clients[socketIds.indexOf(socketId)]?.rtt,
    /** Lets gathered progress go out. */
    settle: () => fire(PROGRESS),
    /** Fires every deadline that has not been cleared. */
    expire: () => fire(DEADLINE),
  };
}

const play = (frame: number): HeldPlay => ({ frame, frameRate: 25 });

console.log('\nrunning a resync');

check('starting asks every client to measure and sends the room the run whole, everyone waiting', () => {
  const h = harness();
  const { requestId, joined } = h.start();
  eq(joined, false, 'joined:');
  eq(h.measured.length, 1, 'measure requests:');
  eq(h.measured[0]!.requestId, requestId, 'request id:');
  eq(h.measured[0]!.deadlineMs, DEADLINE, 'deadline:');
  eq(h.published.length, 1, 'whole statuses:');
  eq(h.view().state, 'measuring', 'state:');
  eq(h.view().requestedBy.name, 'Operator', 'requested by:');
  eq(h.view().clients.length, 3, 'clients:');
  assert(h.view().clients.every(c => c.state === 'waiting'), 'a client did not start as waiting');
  eq(h.timers[0]!.ms, DEADLINE, 'deadline timer:');
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
  eq(h.view().state, 'measuring', 'ended early:');
  h.resyncs.report('room', 'c', { requestId, rtt: 44 });
  eq(h.view().state, 'done', 'state:');
  eq(h.state('a'), 'synced', 'a:');
  eq(h.state('b'), 'failed', 'b (no ping answered):');
  eq(h.rtt('c'), 44, 'c rtt:');
  eq(h.timers[0]!.cleared, true, 'the deadline was left armed:');
  eq(h.progressed.length, 1, 'progress messages (the gathered reports went out with the end):');
});

check('the deadline ends the run and names whoever never answered', () => {
  const h = harness();
  const { requestId } = h.start();
  h.resyncs.report('room', 'a', { requestId, rtt: 12 });
  h.expire();
  eq(h.view().state, 'done', 'state:');
  eq(h.state('a'), 'synced', 'a:');
  eq(h.state('b'), 'no-report', 'b:');
  eq(h.state('c'), 'no-report', 'c:');
});

check('reports for another run, from a stranger, or twice over change nothing', () => {
  const h = harness();
  const { requestId } = h.start();
  eq(h.resyncs.report('room', 'a', { requestId: 'run-old', rtt: 5 }), false, 'foreign run:');
  eq(h.resyncs.report('room', 'zz', { requestId, rtt: 5 }), false, 'stranger:');
  eq(h.resyncs.report('room', 'a', { requestId, rtt: 5 }), true, 'first report:');
  eq(h.resyncs.report('room', 'a', { requestId, rtt: 999 }), false, 'second report:');
  h.settle();
  eq(h.progressed.length, 1, 'progress messages:');
  eq(h.rtt('a'), 5, 'the repeat overwrote the first answer:');
});

check('reports arriving together reach the room as one message, carrying only what changed', () => {
  const h = harness(['a', 'b', 'c', 'd', 'e']);
  const { requestId } = h.start();
  h.resyncs.report('room', 'a', { requestId, rtt: 10 });
  h.resyncs.report('room', 'c', { requestId, rtt: 11 });
  h.resyncs.report('room', 'b', { requestId, rtt: 12 });
  eq(h.progressed.length, 0, 'sent before the gathering window closed:');
  h.settle();
  eq(h.progressed.length, 1, 'progress messages:');
  eq(h.progressed[0]!.changes.map(c => c.index).join(), '0,1,2', 'changed clients:');
  h.resyncs.report('room', 'd', { requestId, rtt: 13 });
  h.settle();
  eq(h.progressed[1]!.changes.map(c => c.index).join(), '3', 'second window:');
  eq(h.state('d'), 'synced', 'd as seen by the room:');
  eq(h.state('e'), 'waiting', 'e as seen by the room:');
});

check('a client that leaves mid-run counts as answered, so it cannot hold the room', () => {
  const h = harness();
  const { requestId } = h.start();
  h.resyncs.report('room', 'a', { requestId, rtt: 10 });
  h.resyncs.leave('room', 'b');
  eq(h.view().state, 'measuring', 'ended before c answered:');
  h.resyncs.leave('room', 'c');
  eq(h.view().state, 'done', 'state:');
  eq(h.state('b'), 'left', 'b:');
  h.resyncs.leave('room', 'a');   // after the run: nothing to do
  eq(h.state('a'), 'synced', 'a changed after the run ended:');
});

check('a room with nobody left in it to ask ends at once', () => {
  const h = harness([]);
  h.start();
  eq(h.view().state, 'done', 'state:');
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
  eq(h.view().playHeld, true, 'playHeld, without waiting for the window:');
  const messages = h.progressed.length;
  eq(h.resyncs.holdPlay('room', play(250)), true, 'second play held:');
  eq(h.progressed.length, messages, 'a repeat Play re-announced an unchanged status:');
  eq(h.released.length, 0, 'released before the run ended:');

  h.resyncs.report('room', 'a', { requestId, rtt: 10 });
  h.resyncs.report('room', 'b', { requestId, rtt: 10 });
  h.resyncs.report('room', 'c', { requestId, rtt: 10 });

  eq(h.released.length, 1, 'plays released:');
  eq(h.released[0]!.frame, 250, 'released frame:');
  eq(h.view().playHeld, false, 'playHeld after release:');
  const done = h.order.indexOf('progress:done');
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
  eq(h.view().playHeld, false, 'playHeld:');
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

check('progress for an earlier run does not touch a later one', () => {
  const h = harness();
  h.start();
  h.expire();
  const stale = encodeProgress({ requestId: 'run-1', state: 'done', playHeld: false, changes: [] });
  h.start();
  eq(applyProgress(h.view(), stale), h.view(), 'applied to the wrong run:');
});

check('measuring() shows a joiner the run in progress, including answers not yet sent, and nothing once it ends', () => {
  const h = harness();
  const { requestId } = h.start();
  h.resyncs.report('room', 'a', { requestId, rtt: 9 });
  const mid = h.resyncs.measuring('room');
  eq(mid?.state, 'measuring', 'mid-run:');
  eq(mid?.clients[0]?.state, 'synced', 'unsent answer:');
  h.expire();
  eq(h.resyncs.measuring('room'), null, 'after the run:');
});

check('published statuses are copies, so later progress cannot rewrite what was sent', () => {
  const h = harness();
  const { requestId } = h.start();
  const first = h.published[0]!;
  h.resyncs.report('room', 'a', { requestId, rtt: 10 });
  h.settle();
  eq(first.clients[0]!.state, 'waiting', 'the earlier broadcast changed:');
});

check('clearing an emptied room stops its deadline and anything it had yet to say', () => {
  const h = harness();
  const { requestId } = h.start();
  h.resyncs.report('room', 'a', { requestId, rtt: 10 });
  h.resyncs.clear('room');
  h.settle();
  h.expire();
  eq(h.progressed.length, 0, 'a cleared run still reported:');
});

console.log(failed ? `\n${failed} failed\n` : '\nall passed\n');
if (failed) process.exit(1);

export {};
