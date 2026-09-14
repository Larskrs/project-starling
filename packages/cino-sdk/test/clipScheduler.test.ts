import { createClipScheduler, type ClipEvent } from '../src/live/clipScheduler.ts';
import { createTimelineModel } from '../src/live/timelineModel.ts';
import { TICK_MS } from '../src/live/transport.ts';
import { fakeTimers } from './fakes.ts';
import { check, eq, finish, near, section } from './harness.ts';

const FPS = 25;

function newModel() {
  const model = createTimelineModel();
  model.load([
    { id: 't1', name: 'Programme', sortOrder: 0, clips: [
      { id: 'A', trackId: 't1', position: 0,   sourceId: 's1', label: 'Open',  mediaStart: null, end: null },
      { id: 'B', trackId: 't1', position: 100, sourceId: 's2', label: 'Close', mediaStart: null, end: 50 },
      { id: 'C', trackId: 't1', position: 200, sourceId: 's1', label: 'Wide',  mediaStart: null, end: null },
    ] },
    { id: 't2', name: 'Preview', sortOrder: 1, clips: [] },
  ]);
  return model;
}

function harness({ leadMs = 0, synced = true } = {}) {
  const model = newModel();
  const events: ClipEvent[] = [];
  const clock = fakeTimers();
  const state = { server: 10_000, synced };
  let run = { frame: 0, at: 10_000 };

  const scheduler = createClipScheduler({
    model,
    leadMs,
    serverNow: () => (state.synced ? state.server : null),
    onClip:    event => { events.push(event); },
    timers:    clock.timers,
  });

  return {
    model, scheduler, events, state,
    armed: clock.armed,
    fire:  clock.fire,
    last:  () => events[events.length - 1]!,
    play(frame: number) {
      run = { frame, at: state.server };
      scheduler.setTransport({ playing: true, frame, frameRate: FPS, at: state.server });
    },
    goTo(frame: number) {
      state.server = run.at + ((frame - run.frame) / FPS) * 1000;
    },
  };
}

section('scheduling');

await check('nothing is announced before the clock is synced', () => {
  const h = harness({ synced: false });
  h.play(90);
  h.scheduler.tick();
  eq(h.events.length, 0, 'events:');
  eq(h.armed().length, 0, 'timers:');
});

await check('joining mid-clip announces the live clip at once, as a catch-up', () => {
  const h = harness();
  h.play(90);
  h.scheduler.tick();
  eq(h.events.length, 1, 'events:');
  eq(h.last().clip?.id, 'A', 'clip:');
  eq(h.last().previous, null, 'previous:');
  eq(h.last().onBoundary, false, 'onBoundary:');
});

await check('no timer while the boundary is more than two ticks away', () => {
  const h = harness();
  h.play(90);
  h.scheduler.tick();
  h.goTo(97);
  h.scheduler.tick();
  eq(h.armed().length, 0, 'timers:');
});

await check('the timer is armed for exactly the time left, and lands on the frame', () => {
  const h = harness();
  h.play(90);
  h.scheduler.tick();
  h.goTo(99.25);
  h.scheduler.tick();
  eq(h.armed().length, 1, 'timers:');
  near(h.armed()[0]!.ms, 30, 0.001, 'delay:');
  eq(30 <= TICK_MS * 2, true, 'fixture inside the arming window:');
  h.state.server += 30;
  h.fire(h.armed()[0]);
  eq(h.last().clip?.id, 'B', 'clip:');
  eq(h.last().previous?.id, 'A', 'previous:');
  eq(h.last().frame, 100, 'frame:');
  eq(h.last().onBoundary, true, 'onBoundary:');
});

await check('a lead fires early, and the tick does not cut back before the playhead arrives', () => {
  const h = harness({ leadMs: 30 });
  h.play(90);
  h.scheduler.tick();
  h.goTo(99);
  h.scheduler.tick();
  near(h.armed()[0]?.ms, 10, 0.001, 'delay:');
  h.state.server += 10;
  h.fire(h.armed()[0]);
  eq(h.last().clip?.id, 'B', 'announced early:');
  h.goTo(99.5);
  h.scheduler.tick();
  h.goTo(100.5);
  h.scheduler.tick();
  eq(h.events.length, 2, 'no cut back to A:');
});

await check('a clip with an end leaves the track with nothing live', () => {
  const h = harness();
  h.play(145);
  h.scheduler.tick();
  h.goTo(149.5);
  h.scheduler.tick();
  h.fire(h.armed()[0]);
  eq(h.last().clip, null, 'clip:');
  eq(h.last().previous?.id, 'B', 'previous:');
  eq(h.last().frame, 150, 'frame:');
});

await check('a seek cancels the armed timer', () => {
  const h = harness();
  h.play(90);
  h.scheduler.tick();
  h.goTo(99.25);
  h.scheduler.tick();
  const timer = h.armed()[0]!;
  h.play(10);
  eq(timer.cancelled, true, 'cancelled:');
  h.scheduler.tick();
  eq(h.armed().length, 0, 'timers:');
  eq(h.events.length, 1, 'still A:');
});

await check('an edit that moves the boundary cancels the timer for the old one', () => {
  const h = harness();
  h.play(90);
  h.scheduler.tick();
  h.goTo(99.25);
  h.scheduler.tick();
  const timer = h.armed()[0]!;
  h.model.applyClipChange({ type: 'upsert', clip: { id: 'B', trackId: 't1', position: 120, end: 50 } });
  h.scheduler.invalidate();
  eq(timer.cancelled, true, 'cancelled:');
  h.scheduler.tick();
  eq(h.armed().length, 0, 'timers:');
  eq(h.events.length, 1, 'events:');
});

await check('an edit to the live clip is not announced as a change', () => {
  const h = harness();
  h.play(50);
  h.scheduler.tick();
  h.model.applyClipChange({ type: 'patch', clip: { id: 'A', label: 'Opening' } });
  h.scheduler.tick();
  eq(h.events.length, 1, 'events:');
  eq(h.scheduler.announced('t1')?.label, 'Opening', 'newest copy remembered:');
});

await check('a boundary a stalled loop missed is still announced, as a catch-up', () => {
  const h = harness();
  h.play(90);
  h.scheduler.tick();
  h.goTo(105);
  h.scheduler.tick();
  eq(h.last().clip?.id, 'B', 'clip:');
  eq(h.last().onBoundary, false, 'onBoundary:');
});

await check('pausing cancels the timer and stops scheduling', () => {
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

await check('reset forgets what was live, so the next tick announces it again', () => {
  const h = harness();
  h.play(90);
  h.scheduler.tick();
  h.scheduler.reset();
  h.play(90);
  h.scheduler.tick();
  eq(h.events.length, 2, 'events:');
});

await check('the playhead is read through the clock, not frozen at the anchor', () => {
  const h = harness();
  h.play(90);
  h.goTo(95);
  near(h.scheduler.currentFrame(), 95, 0.001, 'frame:');
  h.state.synced = false;
  eq(h.scheduler.currentFrame(), null, 'unsynced:');
});

finish();
