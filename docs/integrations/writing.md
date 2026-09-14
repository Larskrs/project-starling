---
public: true
title: Writing changes
order: 5
---

# Writing changes

> Part of the [integration guide](./index.md).

**Every write is a REST call.** Nothing is saved by emitting a socket event. The
server persists the row, then relays it to the room itself, so people in the
editor usually see the change before your own call returns.

Writing through a connection uses the same REST routes, with two advantages. The
change is applied to the local copy the moment the server confirms it, and the
SDK sends the connection's socket id with the request, so the room does not echo
your own change back to you.

| Change | What the token's role needs |
| --- | --- |
| Clips and tracks | `EDIT_TIMELINE` |
| A clip's label only | `EDIT_TIMELINE` or `RENAME_CLIPS` |
| Play, pause, seek and Sync clocks | Nothing beyond access to the timeline |
| Timelines themselves | `MANAGE_TIMELINES` |
| Track types, source sets and sources | `MANAGE_TRACK_TYPES` |
| Storage | `MANAGE_STORAGE` |

A refusal throws a `CinoApiError` that names the missing permission; see
[authentication](./authentication.md#when-a-request-is-refused).

---

## Clips

```ts
const lighting = live.tracks.find('Lighting')!;

// Create. The position is a frame number or a timecode.
const clip = await live.clips.create({ trackId: lighting.id, position: '00:01:12:00', label: 'Cue 13', hue: 210 });

// Update: send only the fields that change.
await live.clips.update(clip!.id, { label: 'Cue 13.5', hue: 30 });
await live.clips.move(clip!.id, '00:01:14:00');
await live.clips.rename(clip!.id, 'Cue 14');

await live.clips.remove(clip!.id);
```

Each write resolves to the clip as it now stands in the local copy.

**Send only the fields you change.** Partial patches are not a style preference.
Two devices editing one clip write different fields, and whoever sends a whole
row silently undoes the other's edit to a field it never meant to touch.
`update` sends exactly the fields you give it and nothing else.

Optional clip fields are `sourceId`, `fileId`, `mediaStart`, `end`, `hue`, and
`data`. `data` is any JSON object up to 2 KB, and it is the place for a device's
own settings on a clip, such as the cue number in the
[lighting example](../examples/lighting-cues.md). When both are set, `end` must
be greater than `mediaStart`.

---

## Tracks

```ts
const type = live.trackTypes.find(trackType => trackType.name === 'Lighting')!;

const track = await live.tracks.create({ typeId: type.id, name: 'LX', icon: 'mdi:lightbulb' });

await live.tracks.update(track!.id, { isMuted: true });
await live.tracks.reorder([track!.id, ...live.tracks.list().map(t => t.id).filter(id => id !== track!.id)]);
await live.tracks.remove(track!.id);
```

A track needs one of the production's track types, and `live.trackTypes` lists
them. A track can change its `name`, `icon`, `isMuted`, `isLocked`, `sourceId`
and `sortOrder`.

Reorder is deliberately lenient. Unknown ids are ignored and omitted tracks keep
their position, so someone adding or deleting a track in the editor at the same
moment does not fail the whole call.

A locked track refuses writes with `423`. The lock is a collaboration signal,
not a permission — someone in the editor is asking to be left alone. Show it to
the operator rather than retrying.

Every successful write is recorded against the token in the production's audit
log. See [limits and logging](./limits.md#what-gets-logged).

---

## Writing without a connection

A device that only writes, such as a script importer or a nightly job, does not
need to connect. `cino.timeline(id)` makes the same calls over REST alone:

```ts
import { fromTimecode } from 'cino-sdk';

const timeline = cino.timeline(timelineId);
const snapshot = await timeline.get();
const script = snapshot.tracks.find(track => track.name === 'Script')!;

const lines = [['00:00:10:00', 'Line 1'], ['00:00:36:00', 'Line 2']] as const;
for (const [timecode, label] of lines) {
  await timeline.clips.create({
    trackId: script.id,
    position: fromTimecode(timecode, snapshot.timeline.frameRate),
    label,
  });
}
```

Without a connection there is no local copy, so positions are frame numbers:
convert timecodes with `fromTimecode` in the timeline's rate.

**Do not announce a write on the socket yourself.** The server relays every
write to the room the moment it is stored, and accepts no relays from clients.

---

## Driving playback

Transport commands are the one thing that does go over the socket, because they
are a request to the room's clock rather than a row to save:

```ts
live.play();                       // from where the playhead is
live.play('00:10:00:00');          // from a frame or a timecode
live.seek('00:12:30:00');
live.pause();
```

Each returns `false`, and sends nothing, when the connection is not up.

- **`play`** makes your frame the room's frame.
- **`seek`** only moves the room while it plays, because a stopped timeline is
  browsed privately by each person in the editor. The SDK sends at most one seek
  every 100ms, always the latest, so a scrub does not flood the room.
- **`pause`** takes no frame. The server works out the stop position from its own
  clock, so every client stops on the same frame.

The server stamps the new anchor when the command **arrives**, and sends it to
the whole room including you. The `transport` event is when it has happened;
until then the command is only a request.

Before the top of a show, sync clocks first, so nobody starts on an estimate
still being refined:

```ts
await live.syncClocks();
live.play('00:00:00:00');          // held by the server until every client has answered
```

---

## Setting up a production

A token with the right role can also prepare what timelines are built from:

```ts
import { readFile } from 'node:fs/promises';

const production = live.production!;   // or cino.production(productionId) without a connection

// A camera track type, and a set of cameras C1…C4 to go with it.
const { trackType, sourceSet } = await production.trackTypes.fromPreset({
  presetId: 'camera',
  cameraSet: { name: 'Cameras', count: 4 },
});

await production.sourceSets.sources(sourceSet!.id).create({ name: 'Crane', shortName: 'CRN', hue: 200 });

// Storage takes images and audio.
const { file } = await production.storage.upload({
  data: await readFile('stage-plot.png'),
  name: 'stage-plot.png',
  type: 'image/png',
});
```

`production.trackTypes.presets()` lists the presets. A connection also reaches
its production as `live.production`, once it is ready.

Next: [limits and logging](./limits.md).
