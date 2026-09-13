---
public: true
title: Reading a timeline
order: 3
---

# Reading a timeline

> Part of the [integration guide](./index.md).

Always bootstrap over REST before trusting a single socket event. The socket
carries changes, not state. A client that builds its model from events alone is
wrong from the first one it misses.

---

## The bootstrap

```bash
curl -s "https://cino.no/api/timeline/$TIMELINE_ID" \
  -H "Authorization: Bearer $CINO_TOKEN"
```

```jsonc
{
  "timeline": { "id": "...", "name": "Act 1", "frameRate": "25", "startFrame": 0 },
  "tracks": [
    {
      "id": "trk_1", "name": "Lighting", "mode": "event", "sortOrder": 0,
      "isMuted": false, "isLocked": false, "typeId": "...", "sourceId": null,
      "clips": [
        {
          "id": "clp_1", "trackId": "trk_1", "label": "Cue 12",
          "position": 1500, "mediaStart": null, "end": null,
          "hue": 210, "fileType": null
        }
      ]
    }
  ],
  "trackTypes": [],
  "sources": []
}
```

Clips arrive nested under their track, already ordered. `position` is a frame
number, and the timeline's `frameRate` converts it to wall time. Frames are
integers everywhere; there is no sub-frame position.

---

## Joining the room

```js
import { io } from 'socket.io-client';

const BASE = 'https://cino.no';
const TIMELINE_ID = process.env.CINO_TIMELINE_ID;

let tracks = new Map();   // trackId -> track (with a .clips array)

async function bootstrap() {
  const res = await fetch(`${BASE}/api/timeline/${TIMELINE_ID}`, {
    headers: { Authorization: `Bearer ${process.env.CINO_TOKEN}` },
  });
  if (!res.ok) throw new Error(`bootstrap failed: ${res.status}`);
  const data = await res.json();
  tracks = new Map(data.tracks.map(t => [t.id, t]));
  return data.timeline;
}

const socket = io(`${BASE}/timeline`, {
  path: '/socket',
  // Polling first, upgrading to WebSocket when the network allows it. cino.no's
  // proxy does not forward the upgrade, so websocket-only never connects there.
  transports: ['polling', 'websocket'],
  auth: { token: process.env.CINO_TOKEN },
});

socket.on('connect', async () => {
  // Re-bootstrap on EVERY connect, not only the first. A reconnect means the
  // gap was unobserved, and there is no replay — refetching is the only
  // complete repair.
  await bootstrap();

  socket.emit('timeline:join', { timelineId: TIMELINE_ID }, (ack) => {
    if (ack.error) return console.error('join refused:', ack.error);
    console.log('joined. canEdit =', ack.canEdit);
  });
});
```

The join acknowledgement tells you what this token may do, so a read-only
device can disable its own controls rather than discovering the answer as a
`403` in the middle of a show.

---

## Clip and track events

Both payloads are discriminated unions. Switch on `type` and nothing else.

```js
socket.on('clip:change', (change) => {
  const track = tracks.get(change.trackId);
  if (!track) return;                      // a track we have not fetched yet

  if (change.type === 'upsert') {
    const i = track.clips.findIndex(c => c.id === change.clip.id);
    if (i === -1) track.clips.push(change.clip);
    else track.clips[i] = change.clip;
  } else if (change.type === 'remove') {
    track.clips = track.clips.filter(c => c.id !== change.clipId);
  }
});

socket.on('track:change', (change) => {
  if (change.type === 'upsert') {
    const existing = tracks.get(change.track.id);
    tracks.set(change.track.id, { ...change.track, clips: existing?.clips ?? [] });
  } else if (change.type === 'remove') {
    tracks.delete(change.trackId);
  } else if (change.type === 'reorder') {
    change.order.forEach((id, i) => {
      const t = tracks.get(id);
      if (t) t.sortOrder = i;
    });
  }
});
```

Three things to note, each of which is a bug if you miss it.

**`upsert` covers create and update.** There is no separate create event, so
never assume an upsert is new. Key by id and replace.

**A `remove` carries `trackId` as well as `clipId`,** because once the row is
gone there is nothing left to look the track up from.

**`reorder` sends the full order**, not a delta. Tracks missing from the list
keep their existing `sortOrder`.

---

## Presence

`timeline:presence` carries the room's current occupants after any change, as a
complete list rather than a diff. A token appears under its own label, so a desk
shows as `FOH Lighting Desk` rather than as the person who installed it.

```js
socket.on('timeline:presence', (users) => {
  console.log('in the room:', users.map(u => u.name).join(', '));
});
```

---

## Following the playhead

The server owns the transport clock. Clients never stream positions. They
receive an **anchor** and derive the rest:

```js
const clock = createServerClock(socket);   // from Clocks and timing
let transport = null;
socket.on('transport:state', (state) => { transport = state; });   // keep it as it arrived

function currentFrame() {
  if (!transport) return null;
  if (!transport.playing) return transport.frame;
  if (!clock.synced) return null;          // no server time measured yet
  return transport.frame + ((clock.now() - transport.at) / 1000) * transport.frameRate;
}
```

This is why an anchor never goes stale, and why a device connecting mid-show
lands on the right frame immediately.

**`transport.at` is a reading of the server's clock, so compare it with the
server's clock.** Putting `Date.now()` in place of `clock.now()` makes the
playhead wrong by however far off the device's own clock is. A few seconds off
is common, and so is minutes on a box that has never been near a time server.
[Clocks and timing](./timing.md) covers measuring server time with `time:ping`
and keeping it right through a show. It is not optional for anything that fires
on a frame.

If you only need to know which cue is live, prefer `clip:active` over doing your
own frame maths. The server walks the clip boundaries and tells you when the
clip under the playhead changes on a track:

```js
socket.on('clip:active', ({ trackId, clipId, label, frame }) => {
  console.log(`track ${trackId}: ${clipId ? label : '(none)'} at frame ${frame}`);
});
```

It reports a change that has already happened, so it arrives slightly after the
frame it names. That is fine for a display. For cues that must land on the
frame, see [Clocks and timing](./timing.md).

Next: [clocks and timing](./timing.md).
