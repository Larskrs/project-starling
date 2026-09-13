---
public: true
title: Limits and logging
order: 5
---

# Limits and logging

> Part of the [integration guide](./index.md). The token system is specified
> but not yet live on the server.

---

## Hard limits

| | |
| --- | --- |
| Seek commands | 1 per 80ms per socket; excess dropped, not queued |
| Socket relay payload | 32 KB |
| JSON request body | 1 MB |
| Reorder list | 500 tracks |
| Clip `data` | 2 KB serialized |

Seeks are dropped rather than queued on purpose. A scrub is a burst, the
intermediate frames are worthless, and a queue would turn a burst into latency
that outlives the gesture.

---

## Two properties of the system worth designing around

**All room state is per process.** Presence, room membership and transport
anchors live in memory, so the API does not run multi-instance without a
Socket.IO adapter. If you are told the deployment has grown, ask whether that
landed before assuming a device sees the same room as the gallery.

**Restarting the API clears every room.** Clients reconnect and rejoin on their
own and presence repopulates, but a playing transport stops, because the anchor
was in memory. A device should handle a transport that goes quiet the same way
it handles a pause.

---

## What gets logged

Every token action that changes something is recorded in an append-only audit
log: which token, which production, what happened, and when. Authentication
events are logged too — issued, first used, revoked, and rejected with the
reason and the source address.

Reads are not logged, and neither are transport commands or other ephemeral
traffic. A desk scrubbing at speed would otherwise write millions of rows saying
nothing, and an audit trail nobody can read is decoration rather than evidence.

Separately, each token's `lastUsedAt` is updated as it is used. That is a coarse
liveness signal for the Integrations page, not an audit record, and it is
deliberately cheap rather than exact.

---

## Checklist before you ship a device

1. Bootstrap over REST on every connect, not only the first.
2. Switch on `type` for `clip:change` and `track:change`, and treat `upsert` as
   create-or-update.
3. Send partial patches, never whole rows.
4. Send `x-socket-id` on mutations if you hold a socket.
5. Back off on `errors.auth.*`. Do not retry a dead credential in a loop.
6. Read `X-Cino-Token-Expires` and alarm locally with days to spare.
7. Plan the 30-day rotation as an overlap, and rehearse it once before opening
   night.
8. Show the connection and credential state on the device itself. The failure
   you cannot see is the one that ruins a show.
