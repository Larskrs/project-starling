---
public: true
title: Limits and logging
order: 6
---

# Limits and logging

> Part of the [integration guide](./index.md).

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

There is no per-token request rate limit today. Do not build on that. A device
that polls REST to find out what changed is doing the socket's job badly, and a
limit will arrive the first time one misbehaves. Bootstrap once per connect, and
follow the socket after that.

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

A restart also resets the server's clock by a small amount. A device that
re-measures server time on every connect, as [clocks and timing](./timing.md)
describes, absorbs that without anyone noticing. A device that measured once at
boot does not.

---

## What gets logged

Every token has an append-only audit trail in its production, never coalesced
and never trimmed:

| Event | Recorded when | Carries |
| --- | --- | --- |
| `issued` | A token is created | Who issued it, their address, and any permissions the mask withheld |
| `revoked` | A token is revoked | Who revoked it, and their address |
| `rejected` | A request or socket handshake presents a bad token | The reason and the source address |
| `create`, `update`, `delete` | A token's write succeeds | The kind of row and its id |

Reads are not logged, and neither are transport commands or other ephemeral
traffic. A desk scrubbing at speed would otherwise write millions of rows saying
nothing, and an audit trail nobody can read is decoration rather than evidence.

Separately, each token's `lastUsedAt` is updated as it is used, at most once a
minute. That is a coarse liveness signal for the Integrations page, not an audit
record, and it is deliberately cheap rather than exact.

---

## Checklist before you ship a device

1. Bootstrap over REST on every connect, not only the first.
2. Switch on `type` for `clip:change` and `track:change`, and treat `upsert` as
   create-or-update.
3. Derive the playhead from measured server time on a monotonic clock. Keep the
   anchor's `at` as it arrived and convert it on every read. Re-measure on
   connect, every 15 seconds, and on waking. See [clocks and timing](./timing.md).
4. Send partial patches, never whole rows.
5. Send `x-socket-id` on mutations if you hold a socket.
6. Stop on `errors.auth.*` and on `access:revoked`. Do not retry a dead
   credential in a loop.
7. Read `X-Cino-Token-Expires` and alarm locally with days to spare.
8. Plan the 30-day rotation as an overlap, and rehearse it once before opening
   night.
9. Show the connection, credential and clock state on the device itself. The
   failure you cannot see is the one that ruins a show.
