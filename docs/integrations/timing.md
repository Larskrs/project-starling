---
public: true
title: Clocks and timing
order: 4
---

# Clocks and timing

> Part of the [integration guide](./index.md).

A device that fires equipment on a frame is only as accurate as its idea of what
time it is **on the server**. The SDK measures that for you and schedules clip
events and cues against it. This page explains what it does, what it needs from
you, and what accuracy to expect.

---

## Why the server's clock

The server owns the playhead. It never streams positions; it sends an
**anchor**, "the playhead was at `frame` when my clock read `at`", and every
client works out the position from it:

```
frame now = anchor.frame + (serverNow − anchor.at) / 1000 × frameRate
```

That is what makes the network's delay cancel out, and why a device joining
mid-show lands on the right frame at once. But it only works if the device knows
`serverNow`, and it cannot read the server's clock. It has to measure it.

A device's own clock is no substitute. A few seconds off is common, and minutes
off is not rare on a box that has never been near a time server. Every frame
would be wrong by that much.

---

## What the SDK does

A connection measures the server's clock with short pings over the socket, and
keeps the estimate right for as long as it runs:

| When | Pings | Why |
| --- | --- | --- |
| Every connect and reconnect | 5, 120ms apart | Nothing is known yet, or the network path changed |
| After the upgrade to WebSocket | 5 | Samples taken over HTTP long-polling are lopsided |
| Every 15 seconds | 1 | Two clocks drift apart by up to a few ms a minute |
| After the machine slept | 5 | The local clock stood still while it was asleep |

It keeps the fastest recent sample, because a slow ping is slow from queueing and
that skews its estimate. It reads a monotonic local clock, which an operating
system time correction cannot move. It throws out old samples when a new one
proves a clock jumped, and it glides through small corrections so a routine
re-measurement never twitches a cue. [The wire protocol](./protocol.md#server-time)
describes the algorithm in full, for devices that cannot run the SDK.

**Nothing is announced before the first ping answers.** `live.currentFrame()`
is `null` until then, and no clip events or cues fire, because a guess would put
the playhead wherever the two clocks happened to differ.

```ts
live.clock;   // { synced, offsetMs, errorMs }

live.on('clock', ({ outcome, errorMs }) => {
  if (outcome === 'first') showOnPanel(`clock synced, good to ±${errorMs.toFixed(1)}ms`);
  if (outcome === 'jump') showOnPanel('clock jumped and was re-measured');
});
```

`errorMs` is the most the estimate can be off by: half the round trip of the
sample it rests on. It is a guarantee, not an average. `step` means the estimate
moved by more than 40ms and was applied at once; `jump` means the device slept or
the server restarted.

---

## Clip events land on the frame

Clip events, described in [following a timeline](./reading.md#clip-events), are
scheduled in two layers. A tick every 20ms reads the playhead through the clock
and catches up on anything live that has not been announced. Once the next
boundary is less than two ticks away, a one-shot timer is armed for exactly the
milliseconds left, and fires the event on the boundary with `onBoundary: true`.

Arming late keeps the timer short, so a clock correction cannot build up inside
it. Re-reading the clock every tick means a seek, an edit or a correction is
picked up within 20ms.

### Hardware latency: `leadMs`

Equipment takes time to act. A switcher might put the new picture out a frame
after it receives the command, and a lighting desk takes a moment to start a
fade. Tell the SDK how long, and it announces everything that much early:

```ts
const live = cino.connect(timelineId, { leadMs: 40 });
```

Measure it rather than guessing. Film a frame counter through the equipment,
say a timecode display cut on a camera, and count the frames between the command
and the picture changing. Nobody else can measure your hardware for you.

`leadMs` applies to every clip event and cue on the connection. If two pieces of
equipment have very different latencies, give each its own connection.

---

## Cues

A cue runs a function each time playback crosses a frame. Give it a frame, a
timecode, or a function that works the frame out on every tick:

```ts
live.cue('00:01:30:00', () => lights.go(12));
live.cue(4500, ({ onTime }) => console.log(onTime ? 'on time' : 'late'));

// Three seconds before whichever clip on the script track comes next.
const script = live.tracks.find('Script')!;
live.cue(() => {
  const frame = live.currentFrame();
  const next = frame === null ? undefined : live.clips.list(script.id).find(clip => clip.position > frame);
  return next ? next.position - 3 * live.timeline!.frameRate : null;
}, () => console.log('standby'));

const remove = live.cue(9000, () => { /* … */ });
remove();
```

A cue fires when playback **crosses** its frame. Seeking over a cue does not
fire it, and rewinding to before it arms it again. Pressing play exactly on a
cue fires it, with `onTime: false`. A function that returns `null` skips the cue
for that tick.

Use a cue when the moment matters and the clip does not. Use a clip event when
the device needs to know what is live.

---

## Sync clocks

Before a show starts, an operator presses **Sync clocks** in the editor. The
server asks every client in the room — editors and devices alike — to measure
again and report, and **holds any Play pressed meanwhile** until every client
has answered, for up to 4 seconds.

The SDK answers on its own with a fresh measurement. Listen only if your device
has somewhere to show it:

```ts
import { createClockStatusWatch } from 'cino-sdk';

live.on('syncReport', ({ rtt }) => {
  showOnPanel(rtt === null ? 'clock sync: no ping got through' : `clock sync: ±${(rtt / 2).toFixed(1)}ms`);
});

// The whole run, for every client, turned into the few lines worth showing.
const watch = createClockStatusWatch(() => live.timeline?.frameRate ?? 25);
live.on('sync', (status) => {
  for (const line of watch.observe(status)) showOnPanel(line.text);   // "clock sync done: 3/4 within a frame"
});
```

A device can start a run itself, with the same access it needs to send
transport commands. A playback server that wants to be sure before it presses
Play is the usual reason:

```ts
const ack = await live.syncClocks();
if ('error' in ack) console.warn(`clock sync refused: ${ack.error}`);
```

---

## Keep the process free

Timers in Node.js and in browsers fire at the earliest after their delay, and
late when the process is busy. A device that parses a large file, runs a
synchronous loop or writes a flood of logs on the same thread will cut late,
however good its clock is.

The SDK notices when the process froze, and says so:

```ts
live.on('stall', ({ ms }) => console.warn(`process stalled ${ms}ms; anything due during it was late`));
```

It checks once a second and reports freezes longer than 250ms. Change that with
`stallWarnMs`, or turn it off with `0`. A stall is a problem in the device, not
in the clock, and reporting it separately stops it looking like one.

---

## Timecode

```ts
import { toTimecode, fromTimecode } from 'cino-sdk';

toTimecode(1800, '25');            // "00:01:12:00"
toTimecode(1800, '29.97df');       // "00:01:00;02"
fromTimecode('00:10:00;00', '29.97df');   // 17982

live.timecode(frame);              // in the connected timeline's rate
live.toFrame('01:02:03:04');       // a timecode, or a frame number passed through
```

Every method on a connection that takes a position takes either. Timecode counts
whole frames, so at 29.97 a second of timecode is 30 frames. Drop-frame rates
skip frame *numbers*, not frames, and separate the frames with `;`.

---

## What accuracy to expect

The offset is never worse than half the best round trip in the window. On a
WebSocket with a 40ms round trip that is 20ms, half a frame at 25fps. On a local
network it is a few milliseconds.

If the network never lets the connection upgrade to WebSocket, every sample
travels over long-polling. That still works, but expect the estimate to be
looser, and check `errorMs` before trusting it with a frame.

Your device adds its own error on top: a busy process, and your hardware's
latency, which is what `leadMs` is for.

Next: [writing changes](./writing.md).
