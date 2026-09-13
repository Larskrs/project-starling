import { createCueScheduler, type CueEvent } from '../src/live/cues.ts';
import type { TransportAnchor } from '../src/live/transport.ts';
import { fakeTimers } from './fakes.ts';
import { check, eq, finish, near, section } from './harness.ts';

const FPS = 25;

function harness({ leadMs = 0 } = {}) {
  const clock = fakeTimers();
  const state = { server: 10_000, synced: true };
  let anchor: TransportAnchor | null = null;

  const cues = createCueScheduler({
    serverNow: () => (state.synced ? state.server : null),
    transport: () => anchor,
    leadMs,
    timers: clock.timers,
  });

  const events: CueEvent[] = [];
  const listen = (event: CueEvent) => { events.push(event); };

  return {
    cues, events, listen, state,
    armed: clock.armed,
    fire: clock.fire,
    play(frame: number) {
      anchor = { playing: true, frame, frameRate: FPS, at: state.server };
      cues.transportChanged();
    },
    pause() {
      anchor = anchor && { ...anchor, playing: false };
      cues.transportChanged();
    },
    goTo(frame: number) {
      state.server = anchor!.at + ((frame - anchor!.frame) / FPS) * 1000;
    },
  };
}

section('firing');

await check('a timer is armed under two ticks out, and lands on the frame', () => {
  const h = harness();
  h.cues.add(100, h.listen);
  h.play(90);
  h.cues.tick();
  eq(h.armed().length, 0, 'far away:');
  h.goTo(99.25);
  h.cues.tick();
  near(h.armed()[0]?.ms, 30, 0.001, 'delay:');
  h.state.server += 30;
  h.fire(h.armed()[0]);
  eq(h.events.length, 1, 'fired:');
  eq(h.events[0]!.frame, 100, 'frame:');
  eq(h.events[0]!.onTime, true, 'onTime:');
});

await check('a lead arms it earlier', () => {
  const h = harness({ leadMs: 40 });
  h.cues.add(100, h.listen);
  h.play(90);
  h.cues.tick();
  h.goTo(98.5);
  h.cues.tick();
  near(h.armed()[0]?.ms, 20, 0.001, 'delay:');
});

await check('a cue a stalled tick missed fires late', () => {
  const h = harness();
  h.cues.add(100, h.listen);
  h.play(90);
  h.cues.tick();
  h.goTo(105);
  h.cues.tick();
  eq(h.events.length, 1, 'fired:');
  eq(h.events[0]!.onTime, false, 'onTime:');
});

await check('playing from the cue\'s frame fires it', () => {
  const h = harness();
  h.cues.add(100, h.listen);
  h.play(100);
  h.cues.tick();
  eq(h.events.length, 1, 'fired:');
});

section('jumps');

await check('seeking over a cue does not fire it', () => {
  const h = harness();
  h.cues.add(100, h.listen);
  h.play(90);
  h.cues.tick();
  h.play(150);
  h.cues.tick();
  eq(h.events.length, 0, 'events:');
});

await check('it fires once per pass, and again after a rewind', () => {
  const h = harness();
  h.cues.add(100, h.listen);
  h.play(90);
  h.cues.tick();
  h.goTo(101);
  h.cues.tick();
  h.goTo(102);
  h.cues.tick();
  eq(h.events.length, 1, 'once:');
  h.play(50);
  h.cues.tick();
  h.goTo(99.5);
  h.cues.tick();
  h.fire(h.armed()[0]);
  eq(h.events.length, 2, 'again:');
});

await check('pausing cancels an armed cue; paused, nothing fires', () => {
  const h = harness();
  h.cues.add(100, h.listen);
  h.play(90);
  h.goTo(99.5);
  h.cues.tick();
  const timer = h.armed()[0]!;
  h.pause();
  eq(timer.cancelled, true, 'cancelled:');
  h.goTo(120);
  h.cues.tick();
  eq(h.events.length, 0, 'events:');
});

section('sources');

await check('removing a cue cancels its timer', () => {
  const h = harness();
  const off = h.cues.add(100, h.listen);
  h.play(99.5);
  h.cues.tick();
  const timer = h.armed()[0]!;
  off();
  eq(timer.cancelled, true, 'cancelled:');
  eq(h.cues.size, 0, 'size:');
});

await check('a moving frame is followed, and null skips it', () => {
  const h = harness();
  let target: number | null = 100;
  h.cues.add(() => target, h.listen);
  h.play(99.5);
  h.cues.tick();
  const timer = h.armed()[0]!;
  target = 120;
  h.cues.tick();
  eq(timer.cancelled, true, 'old timer cancelled:');
  target = null;
  h.goTo(121);
  h.cues.tick();
  eq(h.events.length, 0, 'skipped:');
});

await check('an unsynced clock fires nothing', () => {
  const h = harness();
  h.cues.add(100, h.listen);
  h.state.synced = false;
  h.play(100);
  h.cues.tick();
  eq(h.events.length, 0, 'events:');
});

finish();
