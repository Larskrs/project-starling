# cino-sdk

The Cino SDK. Use it to read and edit productions, timelines, tracks, clips, track types, sources and storage with one API token, and to follow a timeline live, on the frame, from any device.

It runs in Node 20+ and in browsers.

```sh
npm install cino-sdk
```

```ts
import { Cino } from 'cino-sdk';

const cino = new Cino({ url: 'https://cino.no', token: process.env.CINO_TOKEN! });
```

A token belongs to one production, and its role decides what it may do. When a request is refused, it throws a `CinoApiError`, which tells you why:

```ts
try {
  await cino.production(pid).storage.createFolder({ name: 'Stills' });
} catch (err) {
  if (err instanceof CinoApiError && err.missingPermission) console.log(`needs ${err.missingPermission}`);
}
```

## REST

```ts
const production = cino.production(pid);

await production.get();                        // company, production, this token's permissions
await production.dashboard();
await production.members();
await production.roles();
await production.setImage('banner', file);

const timelines = await production.timelines.list();
const act1 = await production.timelines.find('Act 1');
await production.timelines.create({ name: 'Act 2', frameRate: '25', endFrame: 90_000 });

const timeline = cino.timeline(timelineId);
const { tracks, sources, canEdit } = await timeline.get();
await timeline.update({ name: 'Act 1 (final)' });
await timeline.tracks.create({ typeId, name: 'Cameras' });
await timeline.tracks.reorder([trackB, trackA]);
await timeline.clips.create({ trackId, position: 250, label: 'Wide', sourceId });
await timeline.clips.move(clipId, 300);

await production.trackTypes.presets();
const { trackType, sources: cameras } = await production.trackTypes.fromPreset({
  presetId: 'camera',
  cameraSet: { name: 'Cameras', count: 4 },
});

const sets = await production.sourceSets.list();
await production.sourceSets.sources(sets[0]!.id).create({ name: 'Crane', shortName: 'CRN', hue: 200 });

const { folders, files } = await production.storage.list();
const { file } = await production.storage.upload(blob, { name: 'logo.png' });
await cino.files.rename(file.id, 'Logo');
const bytes = await cino.files.download(file.id, { quality: 80 });
const stream = await cino.files.open(audioId, { range: [0, 65535] });
await cino.folders.remove(folderId);
```

## Live

`connect` does the following:
- fetches the timeline and joins its room
- measures the server clock and keeps it measured
- answers **Sync clocks** from the editor
- keeps every track and clip current

It does this again on every reconnect. When the token is dead, it stops.

```ts
const live = cino.connect(timelineId, { leadMs: 40 });

live.on('ready', ({ timeline }) => console.log(`following ${timeline.name}`));
live.on('authFailed', ({ message }) => console.error(message));

// Every clip change on one track, on its frame. leadMs moves it earlier by your hardware's latency.
live.onTrack('Cameras', ({ clip, onBoundary }) => {
  const camera = live.source(clip?.sourceId)?.shortName;
  if (camera) mixer.cut(camera);
});

// Cues: a frame, a timecode, or a frame worked out on every tick.
live.cue('00:01:30:00', () => lights.go(12));
live.cue(() => live.tracks.find('Script')?.clips[3]?.position ?? null, () => console.log('line 4'));

live.clips.nowPlaying();                       // [{ track, clip }] under the playhead
live.clips.live(trackId, '00:00:10:00');
live.timecode();                               // "00:00:12:07"

live.play('00:00:10:00');
live.seek(500);
live.pause();
await live.syncClocks();                       // every client re-measures; Play waits for it

await live.clips.rename(clipId, 'Close up');   // written over REST, applied locally at once
await live.production?.storage.stats();
```

The events:

| Event | When |
| --- | --- |
| `ready` | Fetched and joined, on every connect. `reconnected` is true after a drop. |
| `clip` | A track's live clip changed. `onBoundary` is true when a timer landed on it. |
| `transport` | Play, pause or seek. |
| `change` | Tracks or clips changed, or the whole timeline was fetched again. |
| `presence` | Who is in the room. |
| `clock` | The first clock sync, a step, or a detected jump. |
| `sync` / `syncReport` | A room-wide clock sync's progress, and this client's answer. |
| `token` | The token's expiry, after every fetch. |
| `disconnected` | Clips and cues keep coming from the last known state. |
| `authFailed` | The client has stopped for good. |
| `error` | Something that is retried. |
| `stall` | The process froze. Anything due during the freeze was late. |

## Timecode

```ts
import { toTimecode, fromTimecode } from 'cino-sdk';

toTimecode(1800, '29.97df');                   // "00:01:00;02"
fromTimecode('00:10:00;00', '29.97df');        // 17982
```

## Building blocks

The pieces `connect` is built from are exported too: `createServerClock`, `startClockSync`, `createTimelineModel`, `createClipScheduler`, `createCueScheduler`, `createClockStatusWatch`, and the wire protocol (`TimelineEvent`, payload types and guards). See the timing guide in `docs/integrations/timing.md`.

## Development

```sh
npm run build -w cino-sdk       # copies the protocol from packages/realtime, then compiles
npm test -w cino-sdk
npm run typecheck -w cino-sdk
```
