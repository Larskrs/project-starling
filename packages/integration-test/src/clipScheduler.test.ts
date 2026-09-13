/**
 * Regression guard for the timeline model and the clip scheduler.
 *
 *     node packages/integration-test/src/clipScheduler.test.ts
 *
 * (Standalone, same convention as the other tests here. Exits non-zero on
 * failure.)
 *
 * The invariants: a clip change is announced by a timer armed for exactly the
 * time left until its boundary; nothing is announced before the clock is
 * known; anything that moves the playhead or the boundary cancels what was
 * armed; and a late or missed boundary is still caught.
 */
import { createClipScheduler, TICK_MS, type TransportAnchor } from './clipScheduler.ts';
import { createTimelineModel } from './timelineModel.ts';
import type { ActiveClip } from './cameraWatch.ts';

let failed = 0;
function check(name: string, fn: () => void): void {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${(err as Error).message}`); }
}
function eq(actual: unknown, expected: unknown, what = ''): void {
  if (actual !== expected) throw new Error(`${what} expected ${String(expected)}, got ${String(actual)}`);
}
function close(actual: number | undefined, expected: number, tolerance: number, what = ''): void {
  if (actual === undefined || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${what} expected ≈${expected}, got ${String(actual)}`);
  }
}

const FPS = 25;   // 40ms a frame

// Programme: A from 0 (no end, so until B), B from 100 lasting 50 frames (so
// a gap from 150), C from 200 onward. Preview is empty.
function newModel() {
  const model = createTimelineModel();
  model.load([
    { id: 't1', name: 'Programme', clips: [
      { id: 'A', trackId: 't1', position: 0,   sourceId: 's1', label: 'Open',  mediaStart: null, end: null },
      { id: 'B', trackId: 't1', position: 100, sourceId: 's2', label: 'Close', mediaStart: null, end: 50 },
      { id: 'C', trackId: 't1', position: 200, sourceId: 's1', label: 'Wide',  mediaStart: null, end: null },
    ] },
    { id: 't2', name: 'Preview', clips: [] },
  ]);
  return model;
}

interface Handle { fn: () => void; ms: number; cancelled: boolean; fired: boolean }

function harness({ leadMs = 0, synced = true } = {}) {
  const model   = newModel();
  const events: { event: ActiveClip; onBoundary: boolean }[] = [];
  const handles: Handle[] = [];
  const state   = { server: 10_000, synced };
  let run = { frame: 0, at: 10_000 };

  const scheduler = createClipScheduler({
    model,
    leadMs,
    serverNow: () => (state.synced ? state.server : null),
    onActive:  (event, onBoundary) => { events.push({ event, onBoundary }); },
    timers: {
      setTimeout(fn, ms) { const h: Handle = { fn, ms, cancelled: false, fired: false }; handles.push(h); return h; },
      clearTimeout(h) { (h as Handle).cancelled = true; },
    },
  });

  return {
    model, scheduler, events, state,
    /** Handles still waiting to fire. */
    armed: () => handles.filter(h => !h.cancelled && !h.fired),
    fire:  (h: Handle | undefined) => { if (!h) throw new Error('no timer to fire'); h.fired = true; h.fn(); },
    /** The room starts playing from `frame`, now. */
    play(frame: number) {
      run = { frame, at: state.server };
      const anchor: TransportAnchor = { playing: true, frame, frameRate: FPS, at: state.server };
      scheduler.setTransport(anchor);
    },
    /** Move the server clock to the moment the running playhead reaches `frame`. */
    goTo(frame: number) {
      state.server = run.at + ((frame - run.frame) / FPS) * 1000;
    },
  };
}

console.log('\ntimeline model');

check('the active clip follows position, end, and the next clip', () => {
  const model = newModel();
  const at = (frame: number) => model.activeAt('t1', frame)?.id ?? null;
  eq(at(0), 'A', 'frame 0:');
  eq(at(99.9), 'A', 'frame 99.9:');
  eq(at(100), 'B', 'frame 100:');
  eq(at(149.9), 'B', 'frame 149.9:');
  eq(at(150), null, 'frame 150 (B has ended):');
  eq(at(200), 'C', 'frame 200:');
  eq(at(100_000), 'C', 'long after (no end):');
  eq(model.activeAt('t2', 50), null, 'empty track:');
});

check('the next boundary is the nearest start or end ahead', () => {
  const model = newModel();
  eq(model.nextBoundaryAfter(0), 100, 'from 0:');
  eq(model.nextBoundaryAfter(100), 150, 'from 100:');
  eq(model.nextBoundaryAfter(150), 200, 'from 150:');
  eq(model.nextBoundaryAfter(200), null, 'from 200:');
});

check('mediaStart shortens a clip the way the server counts it', () => {
  const model = createTimelineModel();
  model.load([{ id: 't', name: 'T', clips: [
    { id: 'X', trackId: 't', position: 10, mediaStart: 20, end: 70, label: null, sourceId: null },
  ] }]);
  eq(model.nextBoundaryAfter(10), 60, 'end:');
});

check('a clip moved to another track leaves the first one', () => {
  const model = newModel();
  model.applyClipChange({ type: 'upsert', trackId: 't2', clip: { id: 'A', trackId: 't2', position: 0, sourceId: 's1' } });
  eq(model.activeAt('t1', 50), null, 'old track:');
  eq(model.activeAt('t2', 50)?.id, 'A', 'new track:');
});

check('removing a track drops its clips', () => {
  const model = newModel();
  model.applyTrackChange({ type: 'remove', trackId: 't1' });
  eq(model.hasTrack('t1'), false, 'hasTrack:');
  eq(model.nextBoundaryAfter(0), null, 'boundaries:');
});

console.log('\nscheduling');

check('nothing is announced before the clock is synced', () => {
  const h = harness({ synced: false });
  h.play(90);
  h.scheduler.tick();
  eq(h.events.length, 0, 'events:');
  eq(h.armed().length, 0, 'timers:');
});

check('joining mid-clip announces the live clip at once, as a catch-up', () => {
  const h = harness();
  h.play(90);
  h.scheduler.tick();
  eq(h.events.length, 1, 'events:');
  eq(h.events[0]!.event.clipId, 'A', 'clip:');
  eq(h.events[0]!.onBoundary, false, 'onBoundary:');
  eq(h.events[0]!.event.trackId, 't1', 'the empty track stays silent:');
});

check('no timer while the boundary is more than two ticks away', () => {
  const h = harness();
  h.play(90);
  h.scheduler.tick();
  h.goTo(97);                       // 120ms left
  h.scheduler.tick();
  eq(h.armed().length, 0, 'timers:');
});

check('the timer is armed for exactly the time left, and lands on the frame', () => {
  const h = harness();
  h.play(90);
  h.scheduler.tick();
  h.goTo(99.25);                    // 30ms left
  h.scheduler.tick();
  eq(h.armed().length, 1, 'timers:');
  close(h.armed()[0]!.ms, 30, 0.001, 'delay:');
  if (30 > TICK_MS * 2) throw new Error('fixture: 30ms should be inside the arming window');

  h.state.server += 30;
  h.fire(h.armed()[0]);
  eq(h.events.length, 2, 'events:');
  eq(h.events[1]!.event.clipId, 'B', 'clip:');
  eq(h.events[1]!.event.frame, 100, 'frame:');
  eq(h.events[1]!.onBoundary, true, 'onBoundary:');
});

check('a lead fires early, and the tick does not cut back before the playhead arrives', () => {
  const h = harness({ leadMs: 30 });
  h.play(90);
  h.scheduler.tick();
  h.goTo(99);                       // 40ms left, minus a 30ms lead
  h.scheduler.tick();
  close(h.armed()[0]?.ms, 10, 0.001, 'delay:');

  h.state.server += 10;
  h.fire(h.armed()[0]);
  eq(h.events.at(-1)!.event.clipId, 'B', 'announced early:');

  h.goTo(99.5);                     // still short of the boundary
  h.scheduler.tick();
  h.goTo(100.5);
  h.scheduler.tick();
  eq(h.events.length, 2, 'no cut back to A:');
});

check('a clip with an end leaves the track with nothing live', () => {
  const h = harness();
  h.play(145);
  h.scheduler.tick();               // B
  h.goTo(149.5);
  h.scheduler.tick();
  h.fire(h.armed()[0]);
  eq(h.events.at(-1)!.event.clipId, null, 'clip:');
  eq(h.events.at(-1)!.event.frame, 150, 'frame:');
});

check('a seek cancels the armed timer', () => {
  const h = harness();
  h.play(90);
  h.scheduler.tick();
  h.goTo(99.25);
  h.scheduler.tick();
  const timer = h.armed()[0]!;
  h.play(10);
  eq(timer.cancelled, true, 'cancelled:');
  h.scheduler.tick();
  eq(h.armed().length, 0, 'timers after the seek:');
  eq(h.events.length, 1, 'no new announcement (still A):');
});

check('an edit that moves the boundary cancels the timer for the old one', () => {
  const h = harness();
  h.play(90);
  h.scheduler.tick();
  h.goTo(99.25);
  h.scheduler.tick();
  const timer = h.armed()[0]!;

  h.model.applyClipChange({ type: 'upsert', trackId: 't1', clip: {
    id: 'B', trackId: 't1', position: 120, sourceId: 's2', label: 'Close', mediaStart: null, end: 50,
  } });
  h.scheduler.invalidate();
  eq(timer.cancelled, true, 'cancelled:');

  h.scheduler.tick();               // B now 830ms away
  eq(h.armed().length, 0, 'timers:');
  eq(h.events.length, 1, 'events:');
});

check('a boundary a stalled loop missed is still announced, as a catch-up', () => {
  const h = harness();
  h.play(90);
  h.scheduler.tick();
  h.goTo(105);                      // the process was busy through the boundary
  h.scheduler.tick();
  eq(h.events.at(-1)!.event.clipId, 'B', 'clip:');
  eq(h.events.at(-1)!.onBoundary, false, 'onBoundary:');
});

check('pausing cancels the timer and stops scheduling', () => {
  const h = harness();
  h.play(90);
  h.scheduler.tick();
  h.goTo(99.25);
  h.scheduler.tick();
  const timer = h.armed()[0]!;
  h.scheduler.setTransport({ playing: false, frame: 99.25, frameRate: FPS, at: h.state.server });
  eq(timer.cancelled, true, 'cancelled:');
  h.goTo(120);
  h.scheduler.tick();
  eq(h.events.length, 1, 'events:');
  eq(h.armed().length, 0, 'timers:');
});

check('reset forgets what was live, so the next tick announces it again', () => {
  const h = harness();
  h.play(90);
  h.scheduler.tick();
  h.scheduler.reset();
  h.play(90);
  h.scheduler.tick();
  eq(h.events.length, 2, 'events:');
  eq(h.events[1]!.event.clipId, 'A', 'clip:');
});

check('the playhead is read through the clock, not frozen at the anchor', () => {
  const h = harness();
  h.play(90);
  h.goTo(95);
  close(h.scheduler.currentFrame() ?? undefined, 95, 0.001, 'frame:');
  h.state.synced = false;
  eq(h.scheduler.currentFrame(), null, 'unsynced:');
});

console.log(failed ? `\n${failed} failed\n` : '\nall passed\n');
if (failed) process.exit(1);

export {};
