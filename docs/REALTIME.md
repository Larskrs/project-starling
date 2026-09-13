# Live updates

How changes reach other people in real time: the write path, the event
contract, the room abstraction, and the reasoning behind each. Written for
someone adding live behaviour to a feature, or debugging why an update did not
arrive.

For the HTTP server, routing and permissions see [API.md](./API.md). For the
native client see [swiftSocket.md](./swiftSocket.md).

---

## 1. The shape of it

<figure class="diagram">
<svg viewBox="0 0 720 210" role="img" aria-label="The author sends a PATCH to a REST route. The route checks permission, writes the row, relays the change to peers with emitTimelineChange, and only then returns the row, so peers usually have the change before the author gets the 200.">
  <defs>
    <marker id="rt-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="d-arrow" />
    </marker>
    <marker id="rt-arrow-accent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="d-arrow d-accent" />
    </marker>
  </defs>
  <rect class="d-box" x="16" y="40" width="130" height="136" rx="10" />
  <text class="d-text" x="81" y="113" text-anchor="middle">author</text>
  <rect class="d-box d-box--wide" x="250" y="20" width="230" height="170" rx="12" />
  <text class="d-label" x="270" y="46">REST route</text>
  <text class="d-step" x="270" y="82">1. check permission</text>
  <text class="d-step" x="270" y="112">2. write the row</text>
  <text class="d-step" x="270" y="142">3. emitTimelineChange(…)</text>
  <text class="d-step" x="270" y="172">4. return the row</text>
  <rect class="d-box d-box--accent" x="574" y="40" width="130" height="136" rx="10" />
  <text class="d-text" x="639" y="100" text-anchor="middle">peers</text>
  <text class="d-sub" x="639" y="124" text-anchor="middle">usually before</text>
  <text class="d-sub" x="639" y="140" text-anchor="middle">the author's 200</text>
  <text class="d-sub" x="198" y="70" text-anchor="middle">PATCH</text>
  <text class="d-sub" x="198" y="188" text-anchor="middle">200</text>
  <text class="d-sub" x="527" y="130" text-anchor="middle">clip:change</text>
  <g>
    <path class="d-line" d="M146,78 L246,78" marker-end="url(#rt-arrow)" />
    <path class="d-line" d="M250,168 L150,168" marker-end="url(#rt-arrow)" />
    <path class="d-line d-line--accent" d="M480,138 L570,138" marker-end="url(#rt-arrow-accent)" />
  </g>
</svg>
</figure>

Two rules sit behind that diagram, and most confusion comes from missing one of
them.

**Postgres is the source of truth; the socket only announces.** Nothing is ever
"saved by sending a socket event". Every persisted change goes through a REST
route that checks permissions and writes the row; the broadcast is a
notification that it happened. A dropped socket therefore loses live updates
and never loses data — reconnecting and refetching is always a complete repair.

**The relay is the server's job, not the client's.** `emitTimelineChange` runs
inside the route, before the response is even serialised, so a peer usually learns about
the change *before* the author's own HTTP call returns.

### Why it works this way

It used to be the other way round: the client PATCHed, awaited the response,
updated its own model, and *then* emitted the relay itself. Measured against a
local database, on the same machine:

| | median | p90 |
| --- | --- | --- |
| REST write (blocking) | 10.4ms | 13.3ms |
| socket relay hop | 0.8ms | 1.0ms |
| **peer saw the change after** | **11.0ms** | **14.1ms** |

The socket hop was **1/13th** of what a peer waited for. The other 93% was the
author's own round trip — a hop the peer had no stake in, serialised in front of
them for no reason. And that is the *flattering* measurement: over a real
network the REST leg grows while the socket leg barely moves, so the ratio only
gets worse with distance.

Moving the relay into the route removes that wait entirely. Same machine, after:

| | median | p90 |
| --- | --- | --- |
| author's REST completes | 7.8ms | 8.4ms |
| **peer sees the change after** | **7.4ms** | **8.1ms** |

Peer latency is now bounded by how long the server takes to write, not by how
far away the author happens to be.

The second benefit is the one that will matter more over time. The old design
depended on **ten separate call sites** each remembering to relay, with the
right payload shape, after every mutation. All ten were correct — but nothing
prevented the eleventh from being wrong, and the failure mode was a silent
desync that only shows up as "it didn't update for me".

---

## 2. Adding live updates to a route

Three lines in the route that already does the write:

```ts
import { TimelineEvent } from '@starling/realtime';
import { emitTimelineChange } from '../../../lib/timelineSockets.js';
import { getSocketId } from '../../../lib/handler.js';

// … after the write, before the return:
emitTimelineChange(timeline.id, TimelineEvent.clipChange,
  { type: 'upsert', trackId: body.trackId, clip: clip! }, getSocketId(event));

return clip!;
```

That is the whole integration. The client does nothing — no emit, no
bookkeeping, no chance to forget.

### Not echoing to the author

`getSocketId(event)` reads the `x-socket-id` header the live client sends on
every mutating request, and the relay skips that socket. Without it the author
receives their own change back and fights their own optimistic state.

The header is **optional everywhere**. curl, the native client, an older web
build, or any caller with no socket at all simply omits it and receives the echo
— which is idempotent, because every payload is an upsert or a delete keyed by
id. Nothing breaks; it is only wasted bytes.

On the web the header is attached centrally in
[`useApi.ts`](../apps/web/src/composables/useApi.ts), which reads a
module-level id published by the editor's socket
([`useLiveSocketId.ts`](../apps/web/src/composables/useLiveSocketId.ts)).
Dozens of call sites use `$fetch` without knowing a socket exists; threading an
id through all of them to serve one header would have been worse than one
well-named module-level value.

---

## 3. The contract lives in one place

`@starling/realtime` ([`packages/realtime`](../packages/realtime)) holds every
event name, payload type and validation guard. The API imports it, the web
client imports it, and a native client can generate from it.

It used to be declared three times — server interface, client interface, and a
table in the docs — with nothing tying them together. Renaming a field meant
finding all three, and missing one produced a runtime desync rather than a build
error. Now a mismatch does not compile.

The package is **types and constants only**: no socket.io import, no runtime
dependencies, nothing environment-specific. It has to be safe for a browser
bundle and a Node server to share.

### Event names are constants

```ts
socket.emit(TimelineEvent.clipChange, change)   // not 'clip:change'
```

A typo in a string literal is an event nobody ever receives, discovered in
production. A typo in a constant does not compile.

### Payloads are discriminated unions

```ts
export type ClipChange =
  | { type: 'upsert'; trackId: string; clip: WireClip }
  | { type: 'remove'; trackId: string; clipId: string };
```

The previous shape was `{ type, trackId, clip?, clipId? }`, which let
`{ type: 'remove', trackId }` — with no `clipId` — typecheck perfectly and then
fail at runtime. Splitting per variant makes the invalid states
unrepresentable, so the compiler catches what a reviewer otherwise has to.

`WireClip`/`WireTrack` are deliberately loose (`{ id, …, [key: string]: unknown }`).
The timeline bootstrap enriches rows with joined fields — `fileType`,
`typeHue`, `sourceShortName` — that no single Drizzle row carries. Pinning the
contract to the DB row type would make the enriched shape a type error at
exactly the point it is most useful. Clients narrow at their own boundary.

### Guards sit beside the types

`isClipChange`, `isTrackChange` and `isTransportCommand` live in the same file
as the types they check, so changing one is an obvious prompt to update the
other. **The server never trusts an inbound payload's shape** — a socket is an
authenticated user, not a trusted one.

---

## 4. Rooms: `createLiveRoom`

[`liveRoom.ts`](../apps/api/src/lib/liveRoom.ts) owns the machinery every live
namespace needs, so a namespace file contains only what makes it different.

It handles: room naming, the presence map, join with an access check,
capability caching, leave, disconnect, presence broadcasts, room-empty cleanup,
and emitting into a room from outside any socket.

```ts
createLiveRoom<TimelineCaps, PresenceUser>(io, {
  namespace: '/timeline', roomPrefix: 'tl', roomIdField: 'timelineId',
  joinEvent: TimelineEvent.join, leaveEvent: TimelineEvent.leave,
  presenceEvent: TimelineEvent.presence,

  async authorize(user, timelineId) { /* → { caps, presence } | null */ },
  onJoined(socket, roomId, caps)    { /* activity log, catch-up state */ },
  onRoomEmpty(roomId)               { /* tear down per-room state */ },
  events(socket, ctx)               { /* this namespace's own handlers */ },
});
```

Three behaviours it guarantees, each of which is easy to get subtly wrong when
hand-written per namespace:

**Presence is per user, not per socket.** Someone with the editor open in two
tabs appears once, and is only announced as leaving when their *last* socket
goes. Hand-rolled versions tend to announce a departure when one tab closes.

**A denied join and a nonexistent room give the same answer.** Room ids are not
enumerable by anyone who can connect.

**Capabilities are resolved once, at join.** `authorize` returns a `caps` object
cached on the socket, so a relay handler never touches the database — no matter
how many events the room produces.

### Access can never drift from REST

`authorize` delegates to `resolveAccessLevel` in
[`production.ts`](../apps/api/src/lib/production.ts) — the same function the
REST preambles use. There is one implementation of "may this user touch this
production", so the socket layer and the HTTP layer cannot disagree.

---

## 5. Transport: the server owns the clock

The one part of the system that is not a relay, and the part most worth
understanding before changing.

Clients **never stream playback positions**. They send commands — `play`,
`pause`, `seek` — and the server keeps a single anchor per room:

```ts
{ playing, frame, frameRate, userId, at }
```

`frame` is the position at server time `at`. While playing, the position at any
server time `t` is:

```
frame + (t − at) / 1000 × frameRate
```

Three properties fall out of this, and all three are the reason it is built this
way rather than by broadcasting positions:

**An anchor never goes stale.** Someone joining a playing room mid-session gets
the anchor and computes the correct frame immediately. A stream of positions
would leave them a frame behind forever.

**A command's network delay cancels out.** Everyone derives from the same
server-stamped anchor, so a client 200ms away lands on the same frame as one in
the next room.

**Pause is authoritative.** The stop frame is computed from the *server* clock,
not taken from whichever client pressed the key, so everyone stops at the same
place.

`at` is a reading of the server's **monotonic** clock
([`clock.ts`](../apps/api/src/lib/clock.ts)), never `Date.now()`. A wall clock
gets stepped by NTP or an operator, and a step would move every room's playhead
at once, because every client's offset was measured against the old reading.

Clients estimate the server's clock as their own monotonic clock plus an offset
measured with `time:ping`
([`transportClock.ts`](../apps/web/src/views/TimelineEditor/audio/transportClock.ts),
scheduled from
[`useTimelineSync.ts`](../apps/web/src/views/TimelineEditor/data/useTimelineSync.ts)).
They ping in a burst on connect, after the WebSocket upgrade and on wake, then
once every 15 seconds. The fastest sample of the last two minutes wins, because
its error is bounded by half its round trip. A sample that contradicts a newer
one means a clock jumped, so it is thrown away. Corrections over 40ms apply at
once, and smaller ones glide.

Three rules keep this correct, and each exists because breaking it was a bug:

- **Read the anchor through the clock at use time.** Store `at` as it arrived
  and compute `frame + (serverNow() − at) × fps` whenever the position is
  needed. Converting `at` to local time once froze the estimate's error at that
  moment into the anchor — for a joiner, the worst estimate of the session —
  until the next play, pause or seek.
- **Do not read an anchor before any offset exists.** The server answers
  `timeline:join` with the anchor immediately, and that reply usually beats the
  first ping. `transportClock.ts` holds it until the first sample lands.
- **Never time against the wall clock.** Both sides use monotonic clocks, so
  only a sleeping machine or a server restart can move the offset, and the
  consistency check catches both.

The integrator-facing version of all this, with a worked camera-cut example, is
[integrations/timing.md](./integrations/timing.md).
[`packages/integration-test`](../packages/integration-test) implements it in a
real client.

### Syncing every clock before a show

The editor's **Sync clocks** button makes every socket in the room re-measure
its clock and report how good its estimate now is (`clock:resync` →
`clock:measure` → `clock:report` → `clock:status`). While a run is going, the
server **holds any Play** and starts it on a fresh anchor once the run ends, so
nobody starts the show on an estimate still being refined.

The rules live in [`clockResync.ts`](../apps/api/src/lib/clockResync.ts), pure
and tested, and the two that matter most are about not trusting the room:

- **A deadline ends every run** (4 seconds). A crashed desk, a closed laptop, or
  an older client that does not know the event is listed as not answering, and
  the Play goes ahead. Otherwise any one of them could hold a show hostage.
- **A socket that leaves mid-run counts as answered**, for the same reason.

On the web, a live Play pressed during a run is sent but not started locally
(`clockSyncing` in `usePlayback.ts`). The server's anchor starts it on every
client at once; starting locally would put this playhead and its audio ahead of
a room that had not started yet.

`transport:state` goes to the whole room **including the sender**, unlike every
other event, so the initiator derives its position from the same anchor as
everyone else rather than from its own local guess.

---

## 6. Optimistic UI and the settle window

The author sees their own change immediately; the row confirming it arrives one
round trip later. Anything showing an in-flight gesture has to survive that gap.

Dropping a clip is the worked example. During the drag the clip renders at
`left + moveAdj`, where `left` derives from `clip.position`. `moveAdj` used to
be cleared the instant the pointer came up — but `clip.position` does not update
until the PATCH returns, so **the clip snapped back to where the drag started
and then jumped forward a round trip later**: a visible bounce on every drop,
worse the further away the server is.

[`EditorClip.vue`](../apps/web/src/views/TimelineEditor/components/EditorClip.vue)
now holds the offset at the frame the drag resolved to, and retires it when the
authoritative position arrives:

```js
watch(() => props.clip.position, () => { moveAdj.value = 0; /* clear timer */ })
```

With a 4s timeout as the failure path — a rejected or dropped PATCH never
updates the position, and without the timer the clip would sit somewhere the
server does not agree with indefinitely. Reverting is the honest outcome: it
shows where the clip actually is.

**The general rule:** hold optimistic state until the authoritative value lands,
clear it when that value arrives, and always have a timeout for the case where
it never does.

---

## 7. Guarantees, limits, and things to know

**Payloads are size-capped** at 32 KB per relay. One client cannot broadcast
megabytes to every peer.

**Seeks are rate-bounded** to one per 80ms per socket — a scrub is a burst, and
the intermediate frames are worthless.

**All state is per process.** Presence, room membership and transport anchors
live in memory. Two API instances behind a load balancer would each hold half
the room and neither would see the other's events. Multi-instance needs a
Socket.IO adapter (Redis) before it can work at all — this is a hard limit, not
a degradation.

**Restarting the API clears every room.** Clients reconnect and rejoin
automatically, presence repopulates, and a playing room re-anchors — but the
transport stops, because the anchor was in memory.

**Compatibility path.** `clip:change` and `track:change` are still accepted
*from* clients and relayed, for clients that relay by hand — notably the native
client. A client doing both makes peers apply the same row twice; upserts are
idempotent, so that is wasteful rather than wrong.

---

## 8. Adding a new live entity

1. Add event names and payload types to
   [`packages/realtime`](../packages/realtime), with guards.
2. Create the namespace with `createLiveRoom`, supplying `authorize` (delegating
   to `resolveAccessLevel`) and any namespace-specific handlers.
3. Register it in [`sockets.ts`](../apps/api/src/lib/sockets.ts) beside
   `setupTimelineSockets`.
4. Export an `emitXChange` from the namespace module and call it from each
   mutating REST route, passing `getSocketId(event)`.
5. On the client, subscribe with the shared constants and publish the socket id
   via `setLiveSocketId` on connect.

Note what is *not* on that list: writing presence bookkeeping, remembering to
relay from the client, or declaring the payload shape more than once.
