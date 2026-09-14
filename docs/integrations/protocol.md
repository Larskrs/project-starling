---
public: true
title: The wire protocol
order: 7
---

# The wire protocol

> Part of the [integration guide](./index.md).

Everything cino-sdk does, described on the wire, for a device that cannot run
JavaScript: a C++ lighting console, a Swift app, a Python script on a media
server. If your device can run the SDK, use it instead. Everything on this page
is easy to get subtly wrong, and the SDK is tested against all of it.

The examples are in JavaScript with `socket.io-client`, because it reads plainly.
The server speaks Socket.IO v4, which has clients for most languages. This page
describes **protocol 2**.

---

## What a client does

1. Declare protocol 2 in the handshake, and stop if the server refuses it.
2. Authenticate every request with the token.
3. On every connect, including reconnects, fetch the whole timeline over REST.
4. Join the timeline's room.
5. Apply clip and track changes as the room relays them.
6. Measure the server's clock, and keep measuring it.
7. Work out the playhead from the room's anchor and the measured clock, and the
   live clips from the playhead.
8. Answer **Sync clocks** within 4 seconds.
9. Write over REST, sending the socket id.
10. Stop on a dead credential.

---

## Why the messages are short

Event names are one or two letters, and a payload that always has the same shape
is an array rather than an object. A show's devices are often on HTTP
long-polling behind a proxy, where every message rides an HTTP request, and the
busiest moments — a show starting, the API restarting — are when every device
talks at once. Small messages, and fewer of them, keep a throttling proxy out of
the show. Every shape is spelled out below.

| Event | Direction | Payload |
| --- | --- | --- |
| `j` | you → server | the timeline id, acknowledged with the room |
| `l` | you → server | none |
| `u` | server → you | the room's occupants |
| `ca` `cu` `cd` | server → you | a clip created, changed or removed |
| `ta` `tu` `td` `to` | server → you | a track created, changed or removed; the track order |
| `a` | server → you | the transport anchor |
| `x` | you → server | a transport command |
| `p` | you → server | none, acknowledged with the server's clock |
| `r` | you → server | none, acknowledged with a sync run's id |
| `m` | server → you | measure your clock now |
| `e` | you → server | your measurement |
| `s` `sp` | server → you | a sync run whole, then what changed in it |
| `access:revoked` | server → you | your access ended |

---

## Authenticating

REST takes the token as a bearer token:

```bash
curl -s "https://cino.no/api/timeline/$TIMELINE_ID" \
  -H "Authorization: Bearer $CINO_TOKEN"
```

Every successful response carries the token's expiry in `X-Cino-Token-Expires`,
as an ISO 8601 date.

The socket takes it in the handshake `auth` payload, not in a header, beside the
protocol your client speaks. Browsers cannot set headers on a WebSocket upgrade,
and one form means one code path on the server.

```js
import { io } from 'socket.io-client';

const socket = io('https://cino.no/timeline', {
  path: '/socket',
  // Start on long-polling and upgrade when the network allows it. cino.no's
  // proxy does not forward WebSocket upgrades, so a websocket-only client
  // never connects there.
  transports: ['polling', 'websocket'],
  auth: { token: process.env.CINO_TOKEN, protocol: 2 },
});
```

Native clients send no `Origin` header. The server's allowlist permits that
explicitly, so there is no CORS configuration to do.

A refused handshake arrives as `connect_error`, with an error key as its message.
Losing access while connected arrives as `access:revoked`, just before the server
closes the socket. **Do not reconnect after either.** Neither will fix itself,
and a device hammering the handshake is what takes an API instance down on a
show night.

```js
socket.on('connect_error', (err) => {
  if (err.message === 'errors.protocol.unsupported') {
    console.error(`the server speaks protocol ${err.data?.protocol}; this client speaks 2`);
    socket.disconnect();
  } else if (String(err.message).startsWith('errors.auth.')) {
    socket.disconnect();
  }
});
socket.on('access:revoked', () => socket.disconnect());
```

### The protocol version

The server checks `protocol` before it looks at the token. It refuses any number
but its own with `errors.protocol.unsupported`, and `err.data.protocol` names the
protocol the server speaks: higher than yours means this client needs updating,
lower means the server does. Show that on the device. A handshake without a
`protocol` is treated as protocol 1, the unversioned original, and refused the
same way. A successful join repeats the server's number in its acknowledgement.

The REST failure shapes are in [authentication](./authentication.md#when-a-request-is-refused).

---

## The bootstrap

```jsonc
// GET /api/timeline/{id}
{
  "timeline": { "id": "...", "productionId": "...", "name": "Act 1", "frameRate": "25", "startFrame": 0 },
  "tracks": [
    {
      "id": "trk_1", "name": "Lighting", "mode": "event", "sortOrder": 0,
      "isMuted": false, "isLocked": false, "typeId": "...", "sourceId": null,
      "clips": [
        {
          "id": "clp_1", "trackId": "trk_1", "label": "Cue 12",
          "position": 1500, "mediaStart": null, "end": null,
          "hue": 210, "sourceId": null, "data": null
        }
      ]
    }
  ],
  "trackTypes": [],
  "sources": [],
  "canEdit": false
}
```

Clips arrive nested under their track, ordered by position. `position` is a
frame number, and frames are whole numbers everywhere.

---

## Joining the room

```js
socket.on('connect', async () => {
  // On EVERY connect, not only the first. A reconnect means the gap went
  // unobserved, and the room does not replay it.
  await bootstrap();

  socket.emit('j', TIMELINE_ID, (ack) => {
    if (ack.error) return console.error('join refused:', ack.error);
    occupants = readOccupants(ack.users);              // see "Who is in the room"
    if (ack.anchor) transport = readAnchor(ack.anchor); // see "The playhead"
    if (ack.sync) sync = ack.sync;                      // see "Syncing on request"
    console.log('joined; canEdit =', ack.canEdit);
  });
});
```

The acknowledgement is `{ ok: true, protocol, canEdit, canRename, users, anchor?, sync? }`
or `{ error }`. It carries everything about the room you would otherwise wait for:
`users` is the occupant list, `anchor` is there while the room is playing, and
`sync` while a clock sync is running. `l` leaves without disconnecting.

---

## Clip and track events

A created row arrives whole; a change arrives as only the fields that changed.

```js
const CLIP_NULLABLE = ['fileId', 'mediaStart', 'end', 'sourceId', 'hue', 'data'];
const clips = new Map();   // clip id → the clip, the same object its track lists

const byPosition = (a, b) => a.position - b.position;

socket.on('ca', (row) => {                 // created
  const track = tracks.get(row.trackId);
  if (!track) return;                      // a track we have not fetched
  for (const key of CLIP_NULLABLE) row[key] ??= null;
  clips.set(row.id, row);
  track.clips = [...track.clips.filter(c => c.id !== row.id), row].sort(byPosition);
});

socket.on('cu', (patch) => {               // changed: { id, ...changed fields }
  const clip = clips.get(patch.id);
  if (!clip) return;                       // nothing to apply it to
  Object.assign(clip, patch);
  tracks.get(clip.trackId)?.clips.sort(byPosition);
});

socket.on('cd', (clipId) => {              // removed
  const clip = clips.get(clipId);
  if (!clip) return;
  clips.delete(clipId);
  const track = tracks.get(clip.trackId);
  if (track) track.clips = track.clips.filter(c => c.id !== clipId);
});

socket.on('ta', (row) => tracks.set(row.id, { icon: null, sourceId: null, ...row, clips: [] }));
socket.on('tu', (patch) => { const track = tracks.get(patch.id); if (track) Object.assign(track, patch); });
socket.on('td', (trackId) => {
  for (const clip of tracks.get(trackId)?.clips ?? []) clips.delete(clip.id);
  tracks.delete(trackId);
});
socket.on('to', (order) => order.forEach((id, i) => {
  const track = tracks.get(id);
  if (track) track.sortOrder = i;
}));
```

Four things to note, each of which is a bug if you miss it.

**A created row leaves out its null columns.** For a clip that is `fileId`,
`mediaStart`, `end`, `sourceId`, `hue` and `data`, and a clip also leaves out
`createdAt` and `updatedAt`. For a track it is `icon` and `sourceId`. Treat a
missing one as null.

**A change carries only what changed, and a null in it is a change.**
`{ "id": "clp_1", "end": null }` means the clip no longer has an end. Merge it
field by field into what you hold. Ignore a change for a row you do not hold:
your copy is already out of date, and your next reconnect fetches it whole.

**Keep the fields the bootstrap joined in.** A relayed row never has them
(`fileType` on a clip; `typeName` and its neighbours on a track), so never
replace a whole row with a relayed one.

**`to` sends the full order**, not a delta. Tracks missing from the list keep
their existing `sortOrder`.

### Who is in the room

`u` carries the room's occupants as a complete list, one array each:

```jsonc
[
  ["8c1f…", "Stage manager", null, 1709288430],   // id, name, avatar image id, account created (epoch seconds)
  ["token:4e2a…", "Lighting desk"]                // a device: no avatar, no creation time
]
```

Trailing elements are left out when there is nothing in them. A token's id
starts with `token:`. The list arrives about a quarter of a second after a
change, so a room filling up all at once hears one list rather than one per
arrival. Your own list on joining is in the acknowledgement.

---

## The playhead

The server owns the transport clock and sends an **anchor** in `a`:
`[playing, frame, at, frameRate]`, with `playing` as `1` or `0`. It means the
playhead was at `frame` when the server's clock read `at`. The playhead now is:

```js
socket.on('a', ([playing, frame, at, frameRate]) => {
  transport = { playing: playing === 1, frame, at, frameRate };
});

function currentFrame() {
  if (!transport) return null;
  if (!transport.playing) return transport.frame;
  if (!clock.synced) return null;          // no server time measured yet
  return transport.frame + ((clock.now() - transport.at) / 1000) * transport.frameRate;
}
```

**Keep `at` exactly as it arrived, and convert it every time you read the
position.** The clock estimate keeps improving, and a conversion done once
freezes whatever error it had then. For a device joining a room that is already
playing, that is the first ping, which is the worst one.

**`at` is a reading of the server's clock, so compare it with the server's
clock.** `Date.now()` in place of `clock.now()` puts the playhead off by however
far the device's own clock is off.

A clip is live from its `position`. With an `end` it lasts `end − mediaStart`
frames, with `mediaStart` counting as 0 when null. Without an `end` it lasts
until the next clip on the track. Between clips nothing is live.

```js
function liveClip(track, frame) {
  let live = null;
  for (const clip of track.clips) {          // sorted by position
    if (clip.position > frame) break;
    live = clip;
  }
  if (!live || live.end == null) return live;
  return frame < live.position + (live.end - (live.mediaStart ?? 0)) ? live : null;
}
```

The server does not announce when the live clip changes: an event sent as a
boundary passed would arrive late by the network. Work boundaries out on the
device. Check what is live on a short tick, every 20ms, and once the next
boundary (the nearest clip start or end ahead of the playhead) is under two
ticks away, arm a one-shot timer for exactly the time left, less your hardware's
latency.

---

## Server time

`serverNow = localNow + offset`. This section is about measuring `offset`,
choosing `localNow`, and keeping both honest.

### Measuring the offset

`p` is an acknowledged event. Send it with no payload, and the acknowledgement
carries the server's clock reading in milliseconds:

```js
const t0 = localNow();
socket.timeout(2000).emit('p', (err, serverTime) => {
  if (err) return;                 // a lost ping is just a missing sample
  addSample(t0, localNow(), serverTime);
});
```

<figure class="diagram">
<svg viewBox="0 0 780 220" role="img" aria-label="A ping leaves the device at t0 and its reply lands at t2. The server read its clock, serverTime, at some moment in between, so the true offset lies inside the window from t0 to t2, and the estimate is off by at most half the round trip.">
  <defs>
    <marker id="pw-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="d-arrow" />
    </marker>
    <marker id="pw-arrow-accent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="d-arrow d-accent" />
    </marker>
  </defs>
  <rect class="d-span" x="160" y="60" width="440" height="90" />
  <text class="d-label" x="20" y="64">device</text>
  <text class="d-label" x="20" y="154">server</text>
  <line class="d-line d-line--dashed" x1="100" y1="60" x2="760" y2="60" />
  <line class="d-line d-line--dashed" x1="100" y1="150" x2="760" y2="150" />
  <text class="d-sub" x="380" y="30" text-anchor="middle">rtt = t2 − t0</text>
  <text class="d-step" x="160" y="46" text-anchor="middle">t0</text>
  <text class="d-step" x="600" y="46" text-anchor="middle">t2</text>
  <text class="d-step" x="380" y="176" text-anchor="middle">serverTime</text>
  <text class="d-sub" x="380" y="206" text-anchor="middle">the server's reading happened somewhere inside the shaded window</text>
  <g>
    <path class="d-line" d="M160,60 L376,148" marker-end="url(#pw-arrow)" />
    <path class="d-line d-line--accent" d="M384,148 L597,62" marker-end="url(#pw-arrow-accent)" />
  </g>
  <circle class="d-arrow" cx="160" cy="60" r="4" />
  <circle class="d-arrow" cx="380" cy="150" r="4" />
  <circle class="d-arrow" cx="600" cy="60" r="4" />
</svg>
</figure>

The server read its clock at some moment between your `t0` and `t2`. You know
nothing more than that, and you need nothing more:

```
rtt    = t2 − t0
offset = serverTime + rtt / 2 − t2     // best guess: the trip was symmetric
error  ≤ rtt / 2                       // guaranteed, whatever the network did
```

**Keep the sample with the lowest round trip, and do not average.** Latency only
ever adds. A slow ping is slow because it waited in a queue, usually in one
direction, and that one-sided wait is exactly what skews its estimate.

### Which clock to read

Use a **monotonic** clock for `localNow`, never the wall clock. A wall clock gets
corrected whenever the operating system syncs with a time server, and each
correction moves `localNow` without moving the server. A monotonic clock only
counts forward. Its starting point is arbitrary, which does not matter: the
offset absorbs it.

| Platform | Monotonic clock, in ms | Keeps counting while asleep |
| --- | --- | --- |
| Browser, Node.js | `performance.timeOrigin + performance.now()` | Varies by browser and OS |
| Swift | `CACurrentMediaTime() * 1000` | No |
| Android | `SystemClock.elapsedRealtime()` | Yes |
| Linux, C | `clock_gettime(CLOCK_MONOTONIC)` | No; `CLOCK_BOOTTIME` does |
| Python | `time.monotonic() * 1000` | Depends on the OS |

The server's readings look like Unix epoch milliseconds, but they come from a
monotonic clock of its own. They drift from wall-clock time over the server's
uptime and jump a little when the API restarts. Never format `at` as a date, and
only ever compare it with your estimate of `serverNow`.

### Keep measuring

| When | Pings | Why |
| --- | --- | --- |
| Every connect and reconnect | 5, 120ms apart | Nothing is known yet, or the network path changed |
| After the upgrade to WebSocket | 5 | Samples taken over HTTP long-polling are lopsided |
| Every 15 seconds | 1 | Two clocks drift apart by up to a few ms a minute |
| On waking, or when the network returns | 5 | The monotonic clock may have stood still |

Keep samples from the last **2 minutes**, at most 24 of them, and use the one with
the lowest round trip. Drop older samples even when their round trip was better:
the two clocks tick at slightly different rates, so an old sample describes an
offset that is no longer quite true.

To notice waking, compare how far the wall clock and the monotonic clock moved
between two checks a couple of seconds apart. A difference of more than a second
means the monotonic clock stood still.

### Catching a clock that jumped

Against two clocks that both kept running, two samples can never disagree by
more than half their round trips added together:

```
|offsetA − offsetB|  ≤  (rttA + rttB) / 2  +  10ms slack
```

When a new sample breaks that against an older one, one of the clocks moved: the
device slept, or the API restarted. Throw away every older sample it disagrees
with and adopt the new estimate straight away.

### Correcting without a twitch

When the estimate moves by more than **40ms**, jump straight to it, because being
right matters more than being smooth. For anything smaller, move towards the new
value at no more than **5ms per second**, so a routine re-measurement never makes
a playhead flicker or a cue fire twice.

<figure class="diagram">
<svg viewBox="0 0 700 640" role="img" aria-label="Flowchart. When a ping is answered, measure its round trip and offset. If it contradicts older samples, a clock jumped: drop those samples and apply the estimate at once. Otherwise take the lowest round trip from the last two minutes; if the estimate moved more than 40ms apply it at once, else glide towards it at up to 5ms per second. Either way, server time is local time plus the offset.">
  <defs>
    <marker id="smp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="d-arrow" />
    </marker>
    <marker id="smp-arrow-accent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="d-arrow d-accent" />
    </marker>
  </defs>
  <g>
    <path class="d-line" d="M220,54 L220,86" marker-end="url(#smp-arrow)" />
    <path class="d-line" d="M220,164 L220,194" marker-end="url(#smp-arrow)" />
    <path class="d-line" d="M325,232 L448,232" marker-end="url(#smp-arrow)" />
    <path class="d-line" d="M220,268 L220,300" marker-end="url(#smp-arrow)" />
    <path class="d-line" d="M560,260 L560,400" marker-end="url(#smp-arrow)" />
    <path class="d-line" d="M220,358 L220,390" marker-end="url(#smp-arrow)" />
    <path class="d-line" d="M330,430 L448,430" marker-end="url(#smp-arrow)" />
    <path class="d-line" d="M220,468 L220,496" marker-end="url(#smp-arrow)" />
    <path class="d-line d-line--accent" d="M220,546 L220,580" marker-end="url(#smp-arrow-accent)" />
    <path class="d-line d-line--accent" d="M560,458 L560,604 L372,604" marker-end="url(#smp-arrow-accent)" />
  </g>
  <g>
    <rect class="d-box" x="120" y="14" width="200" height="40" rx="20" />
    <text class="d-text" x="220" y="38.2" text-anchor="middle">a ping is answered</text>
    <rect class="d-box" x="70" y="88" width="300" height="76" rx="10" />
    <text class="d-text" x="220" y="112.2" text-anchor="middle">measure the sample</text>
    <text class="d-step" x="220" y="130.5" text-anchor="middle">rtt = t2 − t0</text>
    <text class="d-step" x="220" y="148.5" text-anchor="middle">offset = serverTime + rtt/2 − t2</text>
    <polygon class="d-box" points="220,196 325,232 220,268 115,232" />
    <text class="d-text" x="220" y="236.2" text-anchor="middle">consistent?</text>
    <rect class="d-box" x="450" y="204" width="220" height="56" rx="10" />
    <text class="d-text" x="560" y="228.2" text-anchor="middle">a clock jumped</text>
    <text class="d-sub" x="560" y="245.0" text-anchor="middle">drop the samples it contradicts</text>
    <rect class="d-box" x="70" y="302" width="300" height="56" rx="10" />
    <text class="d-text" x="220" y="326.2" text-anchor="middle">take the lowest round trip</text>
    <text class="d-sub" x="220" y="343.0" text-anchor="middle">from the last 2 minutes, at most 24</text>
    <polygon class="d-box" points="220,392 330,430 220,468 110,430" />
    <text class="d-text" x="220" y="434.2" text-anchor="middle">moved over 40ms?</text>
    <rect class="d-box" x="450" y="402" width="220" height="56" rx="10" />
    <text class="d-text" x="560" y="426.2" text-anchor="middle">apply it at once</text>
    <text class="d-sub" x="560" y="443.0" text-anchor="middle">right beats smooth</text>
    <rect class="d-box" x="70" y="498" width="300" height="48" rx="10" />
    <text class="d-text" x="220" y="526.2" text-anchor="middle">glide at up to 5ms per second</text>
    <rect class="d-box d-box--accent" x="70" y="582" width="300" height="44" rx="22" />
    <text class="d-step" x="220" y="608.0" text-anchor="middle">serverNow = localNow + offset</text>
  </g>
  <g>
    <text class="d-sub" x="386.5" y="225" text-anchor="middle">no</text>
    <text class="d-sub" x="228" y="283" text-anchor="start">yes</text>
    <text class="d-sub" x="389" y="423" text-anchor="middle">yes</text>
    <text class="d-sub" x="228" y="483" text-anchor="start">no</text>
  </g>
</svg>
</figure>

### Joining a room that is already playing

The join's acknowledgement carries the anchor, and it usually arrives **before**
the first ping comes back. Do not read the position yet: without an offset, the
playhead lands wherever the difference between the two clocks puts it. Hold off
until the first sample, then start reading. If no ping ever answers, show that
the device has no server time rather than guessing.

### The clock, in code

The same algorithm, with the same constants, as the SDK's `createServerClock`
and the web editor:

```js
// serverClock.js
const BURST = 5, GAP_MS = 120, EVERY_MS = 15_000;
const MAX_AGE_MS = 120_000, MAX_SAMPLES = 24, SLACK_MS = 10;
const STEP_MS = 40, SLEW_MS_PER_S = 5;

export const localNow = () => performance.timeOrigin + performance.now();

export function createServerClock(socket) {
  let samples = [];
  let target = null, from = 0, since = 0;   // applied offset glides from `from` towards `target`
  let current = null;                        // the burst under way; concurrent callers share it

  function offsetAt(t) {
    if (target === null) return null;
    const room = (SLEW_MS_PER_S * (t - since)) / 1000;
    return from + Math.max(-room, Math.min(room, target - from));
  }

  function addSample(t0, t2, serverTime) {
    const rtt = t2 - t0;
    const s = { offset: serverTime + rtt / 2 - t2, rtt, at: t2 };

    const fresh = samples.filter(o => s.at - o.at <= MAX_AGE_MS);
    const agree = fresh.filter(o => Math.abs(o.offset - s.offset) <= (o.rtt + s.rtt) / 2 + SLACK_MS);
    samples = [...agree, s].slice(-MAX_SAMPLES);

    const best    = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    const applied = offsetAt(t2);
    const jumped  = agree.length < fresh.length;
    from   = applied === null || jumped || Math.abs(best.offset - applied) > STEP_MS ? best.offset : applied;
    since  = t2;
    target = best.offset;
  }

  function ping() {
    return new Promise((resolve) => {
      if (!socket.connected) return resolve();
      const t0 = localNow();
      socket.timeout(2000).emit('p', (err, serverTime) => {
        if (!err) addSample(t0, localNow(), serverTime);
        resolve();
      });
    });
  }

  function burst() {
    current ??= (async () => {
      for (let i = 0; i < BURST; i++) {
        await ping();
        if (i < BURST - 1) await new Promise(r => setTimeout(r, GAP_MS));
      }
    })().finally(() => { current = null; });
    return current;
  }

  socket.on('connect', () => {
    burst();
    const engine = socket.io.engine;
    if (engine.transport.name !== 'websocket') engine.once('upgrade', () => burst());
  });
  setInterval(() => { if (!current) ping(); }, EVERY_MS);

  return {
    /** False until the first ping has answered. Do not read positions before. */
    get synced() { return target !== null; },
    /** Round trip of the best sample; the offset is good to half this. Null before any. */
    get rtt() { return samples.length ? Math.min(...samples.map(s => s.rtt)) : null; },
    /** The server's clock right now. */
    now() { const t = localNow(); return t + (offsetAt(t) ?? 0); },
    /** Call when the device wakes or its network comes back. */
    burst,
    /** A burst that starts after this call, for `m`. Resolves when it is done. */
    async measure() { if (current) await current; await burst(); },
  };
}
```

Create it before the socket connects, so the first burst starts with the
connection.

---

## Syncing on request

When an operator presses **Sync clocks**, the server asks every client in the
room to re-measure and report, and holds any Play pressed meanwhile until every
client has answered or 4 seconds have passed.

```js
socket.on('m', async ([requestId]) => {
  await clock.measure();                        // a fresh burst
  socket.emit('e', [requestId, clock.rtt]);     // rtt is null if no ping answered
});
```

- **Answer within the deadline, the request's second element: 4 seconds.** A
  device that does not is listed as *did not answer*, and the Play goes ahead
  without it.
- **Measure afresh.** Start a new burst after the request arrives. If a burst is
  already under way, let it finish and then run another, because its first pings
  were sent before anyone asked.
- **`rtt` is the round trip of the sample your estimate rests on**, so the
  operator sees `±rtt/2` next to your device's name. Report `null` when no ping
  answered.

### The events

| Direction | Event | Payload |
| --- | --- | --- |
| anyone → server | `r` | none, acknowledged with `{ ok: true, requestId }` or `{ error }` |
| server → every client | `m` | `[requestId, deadlineMs]` |
| you → server | `e` | `[requestId, rtt]`, with `rtt` in milliseconds or `null` |
| server → every client | `s` | the run whole, as it starts |
| server → every client | `sp` | what changed in the run since |

`s` describes the whole run:

```jsonc
[
  "4f0c2a91",               // requestId
  0,                        // done: 1 once the run has ended
  1,                        // playHeld: 1 while a Play waits for the run to end
  "Stage manager",          // who pressed Sync clocks
  4000,                     // deadlineMs
  [                         // one entry per socket: [id, name, state, rtt?]
    ["token:…", "Vision mixer", 1, 18],
    ["…", "Lighting desk", 0]
  ]
]
```

A client's `state` is an index into `waiting`, `synced`, `failed` (no ping got
through), `no-report` (the deadline passed first) and `left`, and its `rtt` is
left out while it is null. There is one entry per socket, and their order does
not change during a run.

After that the room hears only what changed, in `sp`:

```jsonc
["4f0c2a91", 0, 1, [[1, 1, 22.5]]]   // requestId, done, playHeld, then [index, state, rtt?] per changed client
```

Changes are gathered for up to a quarter of a second. A held Play, a cancelled
one and the end of the run go out straight away, and the end of the run always
reaches you before the Play's anchor does. Apply `sp` only to the run whose
`requestId` it names. A client that joins mid-run gets `s` in its join
acknowledgement.

```js
socket.on('s', (run) => { sync = run; });
socket.on('sp', ([requestId, done, playHeld, changes]) => {
  if (sync?.[0] !== requestId) return;
  sync[1] = done;
  sync[2] = playHeld;
  for (const [index, state, rtt = null] of changes) {
    const client = sync[5][index];
    if (client) { client[2] = state; client[3] = rtt; }
  }
});
```

A report only counts if its `requestId` matches the run in progress and it comes
from a socket that was asked; anything else is ignored.

---

## Writing

| Change | Request |
| --- | --- |
| Create a clip | `POST /api/timeline/{id}/clips` with `{ trackId, position, label?, … }` |
| Change a clip | `PATCH /api/timeline/{id}/clips/{clipId}` with only the changed fields |
| Remove a clip | `DELETE /api/timeline/{id}/clips/{clipId}` |
| Create a track | `POST /api/timeline/{id}/tracks` with `{ typeId, name, icon? }` |
| Change a track | `PATCH /api/timeline/{id}/tracks/{trackId}` |
| Remove a track | `DELETE /api/timeline/{id}/tracks/{trackId}` |
| Reorder tracks | `POST /api/timeline/{id}/tracks/reorder` with `{ order: [trackId, …] }` |

Send your socket id on every write, and the room's relay skips your socket:

```
x-socket-id: <socket.id>
```

Without it your own change comes back as a `ca`, `cu` or `cd`, which is harmless
but wasteful. Never send those events yourself: the server relays every write,
and accepts no relays from clients.

The rules for each field are in [writing changes](./writing.md).

---

## Driving playback

```js
socket.emit('x', [1, 1500]);   // play from frame 1500
socket.emit('x', [2, 2000]);   // seek to frame 2000
socket.emit('x', [0]);         // pause
```

`play` makes your frame the room's frame. `seek` is only accepted while the room
is playing. `pause` takes no frame: the server works out the stop position from
its own clock. The room takes at most one seek per 80ms, from everyone together.
A seek sent sooner waits for its turn and a newer one replaces it, so the room
always lands on the last frame of a scrub. Throttling your own scrub still saves
messages. The new anchor reaches the whole room, including you, as `a`.

---

## Checklist

1. Send `protocol: 2` in the handshake, and stop on `errors.protocol.unsupported`,
   showing which side is out of date.
2. Bootstrap over REST on every connect, not only the first. Take the occupants,
   the anchor and any sync in progress from the join's acknowledgement.
3. Fill in the null columns a created row leaves out, merge changes field by
   field, and ignore a change for a row you do not hold.
4. Work out the playhead from measured server time on a monotonic clock. Keep
   the anchor's `at` as it arrived and convert it on every read. Re-measure on
   connect, after the upgrade, every 15 seconds, and on waking.
5. Answer `m` with a fresh burst and an `e` within 4 seconds.
6. Send partial patches, never whole rows, and `x-socket-id` on writes.
7. Stop on `errors.auth.*` and on `access:revoked`. Do not retry a dead
   credential in a loop.
8. Read `X-Cino-Token-Expires` and alarm locally with days to spare.
9. Show the connection, credential and clock state on the device itself.
