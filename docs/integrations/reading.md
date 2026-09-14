---
public: true
title: Following a timeline
order: 3
---

# Following a timeline

> Part of the [integration guide](./index.md).

There are two ways to read a timeline. Fetch it once over REST when a device
only needs a snapshot, such as a report or a pre-show check. Connect to it when
the device follows the show: the SDK then keeps a local copy current and tells
you when anything changes.

---

## A snapshot over REST

```ts
const { timeline, tracks, sources, trackTypes, canEdit } = await cino.timeline(timelineId).get();

for (const track of tracks) {
  console.log(`${track.name}: ${track.clips.length} clips`);
}
```

Clips arrive nested under their track, sorted by position. `position` is a frame
number, and `timeline.frameRate` (a string such as `'25'` or `'29.97df'`) turns
frames into time. Frames are whole numbers everywhere; there is no sub-frame
position.

A token reaches one production, and the snapshot carries its id, so the rest of
the production is one step away:

```ts
const production = cino.production(timeline.productionId);

const act2 = await production.timelines.find('Act 2');   // by name, ignoring case
const cameras = await production.sourceSets.list();
```

---

## Connecting

```ts
const live = cino.connect(timelineId);

live.on('ready', ({ timeline, reconnected, canEdit }) => {
  console.log(`${reconnected ? 'back on' : 'following'} ${timeline.name}, ${canEdit ? 'read/write' : 'read only'}`);
});

await live.whenReady();   // resolves on the first ready, rejects if the credential is refused
```

On every connect, and again on every reconnect, the SDK:

1. fetches the whole timeline over REST;
2. joins the timeline's live room;
3. measures the server's clock, and keeps measuring it for as long as it is
   connected;
4. applies every clip and track change the room relays.

Fetching again on a reconnect is not a nicety. The room does not replay what it
relayed while you were away, so refetching is the only complete repair, and a
device that skipped it would edit or cut from a copy that is quietly wrong.

`canEdit` says whether this token may write, so a read-only device can disable
its own controls instead of discovering the answer as a `403` mid-show.

---

## The local copy

Once ready, everything is in memory and every read is synchronous:

```ts
live.timeline;                      // name, frameRate (a number), frameRateName, dropFrame, startFrame…
live.tracks.list();                 // every track, in the editor's order
live.tracks.find('Cameras');        // by id, or by name ignoring case
live.clips.list(track.id);          // one track's clips, sorted by position
live.clips.get(clipId);
live.sources;                       // the production's sources, e.g. cameras
live.source(clip.sourceId);         // → { name: 'Camera 1', shortName: 'C1', … } or null
live.trackTypes;
```

A track or clip gives you its common fields directly — `id`, `name`, `position`,
`end`, `label`, `sourceId` — and every field the server sent in `row`, so
`clip.row.hue` and `track.row.isLocked` are there when you need them.

The objects are frozen. A change replaces the object rather than editing it, so
a clip you are holding never changes underneath you. Look it up again to see the
new version.

The `change` event says when the copy moved:

```ts
live.on('change', (event) => {
  if (event.kind === 'refresh') redrawEverything();        // fetched again, e.g. after a reconnect
  else if (event.kind === 'clip') redrawTrack(event.change.trackId);
  else redrawTrackList();                                 // a track was added, edited, removed or reordered
});
```

---

## What is live

A clip is live from its `position`. With an `end` it lasts `end − mediaStart`
frames (`mediaStart` counts as 0 when it is null). Without an `end` it lasts
until the next clip on the track. Between clips nothing is live.

```ts
live.clips.live(track.id);                 // the clip under the playhead, or null
live.clips.live(track.id, '00:10:00:00');  // at a timecode, or a frame number
live.clips.nowPlaying();                   // [{ track, clip }] for every track with something live
```

These answer *what is live now*. To act *when* it changes, listen for clip
events instead of asking in a loop.

---

## Clip events

While the timeline plays, the SDK works out when each track's live clip changes
and announces it on the frame:

```ts
live.onTrack('Cameras', ({ clip, previous, frame, onBoundary }) => {
  const camera = live.source(clip?.sourceId)?.shortName;
  console.log(`${live.timecode(frame)} ${previous?.label ?? '—'} → ${clip?.label ?? 'nothing'} (${camera})`);
});

live.on('clip', (event) => { /* the same, for every track */ });
```

| Field | |
| --- | --- |
| `track` | The track whose live clip changed |
| `clip` | The clip now live, or `null` when the track went quiet |
| `previous` | The clip that was live before, or `null` |
| `frame` | The frame it changed on |
| `at` | The server clock reading when it was announced |
| `onBoundary` | `true` when it landed on the boundary itself; `false` for a catch-up |

A **catch-up** is an announcement that did not come from reaching a boundary.
It happens when the device joins a show that is already playing, when someone
presses play or seeks, when an edit changes what is under the playhead, and when
the process was too busy to announce a boundary on time. Whether to act on a
catch-up is the device's decision: a vision switcher should put the right camera
up at once, and a sound desk should not start a sound cue halfway through.

The server never sends these events. It sends the playhead's anchor, the clips
and every edit, and the device works out the boundaries itself. An event sent as
a boundary passed would reach you late by the network, so the only place a
boundary can be known in time is the device. [Clocks and timing](./timing.md)
covers how the SDK makes that land on the frame.

---

## The playhead

```ts
live.transport;          // { playing, frame, frameRate, at, userId } as the room last sent it, or null
live.currentFrame();     // where the playhead is now, or null before the clock is measured
live.timecode();         // the playhead as timecode, e.g. "00:12:07:14"

live.on('transport', ({ playing }) => {
  console.log(playing ? `playing from ${live.timecode()}` : `stopped at ${live.timecode()}`);
});
```

Clip events and cues only run while the room plays. **A stopped timeline is
browsed privately:** each person in the editor moves their own playhead, and
none of it reaches devices. A pause leaves a device on whatever was live when it
stopped.

---

## Presence

`presence` carries everyone in the room after any change, as a complete list.
A token appears under its own label, and its id starts with
`TOKEN_PRESENCE_PREFIX`, which tells devices apart from people:

```ts
import { TOKEN_PRESENCE_PREFIX } from 'cino-sdk';

live.on('presence', (users) => {
  const devices = users.filter(user => user.id.startsWith(TOKEN_PRESENCE_PREFIX));
  console.log(`${users.length - devices.length} people, devices: ${devices.map(d => d.name).join(', ')}`);
});
```

---

## When the connection drops

```ts
live.on('disconnected', ({ reason }) => showOnPanel(`Cino connection lost (${reason})`));
live.on('error', ({ error }) => console.warn(`retrying: ${error.message}`));
live.on('ready', ({ reconnected }) => { if (reconnected) showOnPanel('Cino connected'); });
```

A dropped connection does not stop a show. Clip events and cues keep coming from
the last timeline and playhead the device knew, and when the connection comes
back the SDK fetches everything again and emits `ready` with `reconnected: true`.
An edit made while the device was away takes effect from that moment.

`live.connected` and `live.ready` say where things stand at any moment, which is
what a status light on the device should show. `live.close()` leaves the room
and stops everything.

Next: [clocks and timing](./timing.md).
