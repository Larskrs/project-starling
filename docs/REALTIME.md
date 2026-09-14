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
<svg viewBox="0 0 720 210" role="img" aria-label="The author sends a PATCH to a REST route. The route checks permission, writes the row, relays the change to peers with timelineRelay, and only then returns the row, so peers usually have the change before the author gets the 200.">
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
  <text class="d-step" x="270" y="142">3. timelineRelay.…(…)</text>
  <text class="d-step" x="270" y="172">4. return the row</text>
  <rect class="d-box d-box--accent" x="574" y="40" width="130" height="136" rx="10" />
  <text class="d-text" x="639" y="100" text-anchor="middle">peers</text>
  <text class="d-sub" x="639" y="124" text-anchor="middle">usually before</text>
  <text class="d-sub" x="639" y="140" text-anchor="middle">the author's 200</text>
  <text class="d-sub" x="198" y="70" text-anchor="middle">PATCH</text>
  <text class="d-sub" x="198" y="188" text-anchor="middle">200</text>
  <text class="d-sub" x="527" y="130" text-anchor="middle">cu</text>
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

**The relay is the server's job, not the client's.** `timelineRelay` runs
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

One line in the route that already does the write:

```ts
import { timelineRelay } from '../../../lib/timelineSockets.js';
import { getSocketId } from '../../../lib/handler.js';

// … after the write, before the return:
timelineRelay.clipUpdated(ctx.timeline.id, updated!, Object.keys(update), getSocketId(event));

return updated;
```

A created row goes out with `clipAdded`/`trackAdded`, a changed one with
`clipUpdated`/`trackUpdated` and the columns the request wrote — only those
travel, read back from the stored row — and a removal with the id. That is the
whole integration. The client does nothing — no emit, no bookkeeping, no chance
to forget.

### Not echoing to the author

`getSocketId(event)` reads the `x-socket-id` header the live client sends on
every mutating request, and the relay skips that socket. Without it the author
receives their own change back and fights their own optimistic state.

The header is **optional everywhere**. curl, a script, or any caller with no
socket at all simply omits it and receives the echo — which is idempotent,
because every change is keyed by id and says what the row now holds. Nothing
breaks; it is only wasted bytes.

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
event name, payload type, and the codec that turns one into the other. The API
imports it, the web client imports it, cino-sdk carries a generated copy, and a
native client can follow it.

It used to be declared three times — server interface, client interface, and a
table in the docs — with nothing tying them together. Renaming a field meant
finding all three, and missing one produced a runtime desync rather than a build
error. Now a mismatch does not compile.

The package has **no dependencies**: no socket.io import, nothing
environment-specific. It has to be safe for a browser bundle and a Node server
to share.

### The wire is compact, and versioned

Protocol 1 sent readable JSON: `transport:state` with named keys on every
anchor, whole rows on every rename, the whole clock-sync table on every report,
the whole presence list on every join. A room of devices on long-polling pays
for every message as part of an HTTP request, and the moments when everything
happens at once — a show starting, the API restarting — are when a throttling
proxy notices. Protocol 2 is the same information, smaller, in fewer messages:

| | Protocol 1 | Protocol 2 |
| --- | --- | --- |
| Event names | `transport:state`, `clip:change` | `a`, `cu` |
| Anchor | `{ playing, frame, frameRate, userId, at }` | `[playing, frame, at, frameRate]` — nobody read `userId` |
| Created row | every column, nulls and timestamps included | null columns and clip timestamps left out, restored by the decoder |
| Changed row | the whole row | `{ id, ...the columns written }` |
| Presence | the full list to the whole room on every join and leave | coalesced for 250ms, sent only to sockets without it; the joiner's is in its ack |
| Join | ack, then presence, anchor and sync status as separate messages | one ack carrying all of them |
| Clock sync | the full table to the room on every report | the table once, then only changed clients, at most every 250ms |
| Seeks | one per 80ms per socket, the rest dropped | one per 80ms per room, the newest kept |

The shortness never reaches application code. The **encoders** (`encodeAnchor`,
`encodeClip`, `encodePatch`, `encodeStatus`, …) are the only place the server
builds a payload, and the **decoders** (`decodeAnchor`, `CLIP_EVENTS`,
`applyProgress`, …) are the only place a client reads one. Both sides program
against `TransportState`, `ClipChange` and `ClockSyncStatus`, never against
arrays.

`PROTOCOL` is the version. Clients send it in the handshake
(`auth: { protocol }`), and `createLiveRoom` refuses any other number **before
authentication**, with `errors.protocol.unsupported` and the server's own number
in `data.protocol`. An outdated device is told why in one round trip and costs
no token lookup; the web editor shows "Reload to reconnect"; cino-sdk emits
`incompatible` and stops. **Bump `PROTOCOL` for any change an older client would
misread.** Additions an older client can ignore do not need it.

### Event names are constants

```ts
socket.emit(TimelineEvent.transportCommand, encodeCommand({ action: 'seek', frame }))   // not 'x'
```

A typo in a string literal is an event nobody ever receives, discovered in
production. A typo in a constant does not compile.

### Payloads are discriminated unions

```ts
export type ClipChange =
  | { type: 'upsert'; clip: WireClip }
  | { type: 'patch'; clip: RowPatch }
  | { type: 'remove'; clipId: string };
```

A bag of optional fields would let `{ type: 'remove' }` — with no `clipId` —
typecheck perfectly and then fail at runtime. Splitting per variant makes the
invalid states unrepresentable, so the compiler catches what a reviewer
otherwise has to. `patch` is its own variant because it means something
different: merge into a row you hold, and ignore it for one you do not.

`WireClip`/`WireTrack` are deliberately loose (`{ id, …, [key: string]: unknown }`).
The timeline bootstrap enriches rows with joined fields — `fileType`,
`typeHue`, `sourceShortName` — that no single Drizzle row carries. Pinning the
contract to the DB row type would make the enriched shape a type error at
exactly the point it is most useful. Clients narrow at their own boundary.

### Decoders are the guards

Every decoder returns `null` for a payload of the wrong shape, and callers drop
it — never half-apply it. **The server never trusts an inbound payload's shape**
(`decodeCommand`, `decodeReport`) — a socket is an authenticated user, not a
trusted one — and clients hold server payloads to the same standard.

---

## 4. Rooms: `createLiveRoom`

[`liveRoom.ts`](../apps/api/src/lib/liveRoom.ts) owns the machinery every live
namespace needs, so a namespace file contains only what makes it different.

It handles: the protocol check, room naming, the presence map, join with an
access check, capability caching, leave, disconnect, presence broadcasts,
room-empty cleanup, and emitting into a room from outside any socket.

```ts
createLiveRoom<TimelineCaps, PresenceSource>(io, {
  namespace: '/timeline', roomPrefix: 'tl', protocol: PROTOCOL, encodePresence,
  joinEvent: TimelineEvent.join, leaveEvent: TimelineEvent.leave,
  presenceEvent: TimelineEvent.presence,

  async authorize(data, timelineId) { /* → { caps, presence } | null */ },
  onJoined(socket, roomId, caps)    { /* activity log; returns what the ack carries */ },
  onRoomEmpty(roomId)               { /* tear down per-room state */ },
  events(socket, ctx)               { /* this namespace's own handlers */ },
});
```

Four behaviours it guarantees, each of which is easy to get subtly wrong when
hand-written per namespace:

**Presence is per user, not per socket.** Someone with the editor open in two
tabs appears once, and is only announced as leaving when their *last* socket
goes. A second tab arriving or leaving changes nobody's list, so it sends
nothing.

**Presence is coalesced.** A change waits `PRESENCE_SETTLE_MS` (250ms) and then
goes only to sockets that do not already hold that version of the list. A room
of twenty reconnecting at once used to cost 210 full lists; now it costs one per
socket, and each joiner's own list rides its join ack.

**A denied join and a nonexistent room give the same answer.** Room ids are not
enumerable by anyone who can connect.

**Capabilities are resolved once, at join.** `authorize` returns a `caps` object
cached on the socket, so a handler never touches the database — no matter how
many events the room produces.

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
{ playing, frame, frameRate, at }        // on the wire: [playing, frame, at, frameRate]
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
measured with the ping event (`TimelineEvent.timePing`)
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
- **Do not read an anchor before any offset exists.** The join's ack carries the
  anchor, and it usually beats the first ping. `transportClock.ts` holds it until
  the first sample lands.
- **Never time against the wall clock.** Both sides use monotonic clocks, so
  only a sleeping machine or a server restart can move the offset, and the
  consistency check catches both.

The integrator-facing version of all this is
[integrations/protocol.md](./integrations/protocol.md#server-time).
[`packages/integration-test`](../packages/integration-test) implements it in a
real client.

### Syncing every clock before a show

The editor's **Sync clocks** button makes every socket in the room re-measure
its clock and report how good its estimate now is (resync `r` → measure `m` →
report `e` → status `s`, then progress `sp`). While a run is going, the server
**holds any Play** and starts it on a fresh anchor once the run ends, so nobody
starts the show on an estimate still being refined.

The rules live in [`clockResync.ts`](../apps/api/src/lib/clockResync.ts), pure
and tested, and the two that matter most are about not trusting the room:

- **A deadline ends every run** (4 seconds). A crashed desk, a closed laptop, or
  an older client that does not know the event is listed as not answering, and
  the Play goes ahead. Otherwise any one of them could hold a show hostage.
- **A socket that leaves mid-run counts as answered**, for the same reason.

The run is announced whole once, as it starts, and after that as only the
clients whose answer came in, gathered for up to 250ms. Sending the table on
every report made a run cost the cube of the room — twenty devices received 420
tables of twenty entries in four seconds. A held Play, a cancelled one and the
end of the run are never gathered, and the end always reaches the room before
the released Play's anchor.

On the web, a live Play pressed during a run is sent but not started locally
(`clockSyncing` in `usePlayback.ts`). The server's anchor starts it on every
client at once; starting locally would put this playhead and its audio ahead of
a room that had not started yet.

The anchor goes to the whole room **including the sender**, unlike every other
event, so the initiator derives its position from the same anchor as everyone
else rather than from its own local guess.

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

**Only the server relays.** Clients cannot broadcast clip or track changes; the
namespace has no handler for them. Every relay is a row a route just validated
and wrote.

**Seeks are rate-bounded per room** to one per 80ms. A seek inside the window
waits for its end and a newer one replaces it — a scrub is a burst, and only its
last frame matters.

**An outdated client is refused, not misread.** A handshake declaring any
protocol but the server's fails with `errors.protocol.unsupported`, and Socket.IO
does not retry it. Deploying a new protocol disconnects old devices with a clear
reason; it never leaves them silently out of step.

**All state is per process.** Presence, room membership and transport anchors
live in memory. Two API instances behind a load balancer would each hold half
the room and neither would see the other's events. Multi-instance needs a
Socket.IO adapter (Redis) before it can work at all — this is a hard limit, not
a degradation.

**Restarting the API clears every room.** Clients reconnect and rejoin
automatically, presence repopulates, and a playing room re-anchors — but the
transport stops, because the anchor was in memory.

---

## 8. Adding a new live entity

1. Add event names, payload types, and an encoder and decoder for each payload
   to [`packages/realtime`](../packages/realtime). Bump `PROTOCOL` if an older
   client would misread the change.
2. Create the namespace with `createLiveRoom`, supplying `authorize` (delegating
   to `resolveAccessLevel`) and any namespace-specific handlers.
3. Register it in [`sockets.ts`](../apps/api/src/lib/sockets.ts) beside
   `setupTimelineSockets`.
4. Export relay helpers from the namespace module, as `timelineRelay` does, and
   call them from each mutating REST route, passing `getSocketId(event)`.
5. On the client, subscribe with the shared constants and decoders, and publish
   the socket id via `setLiveSocketId` on connect.

Note what is *not* on that list: writing presence bookkeeping, remembering to
relay from the client, or declaring the payload shape more than once.
