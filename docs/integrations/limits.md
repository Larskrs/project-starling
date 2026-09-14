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
| Clock sync answer | within 4 s of the request; later answers are ignored |
| Socket relay payload | 32 KB |
| JSON request body | 1 MB |
| Reorder list | 500 tracks |
| Clip `data` | 2 KB serialized |

Seeks are dropped rather than queued on purpose. A scrub is a burst, the
intermediate frames are worthless, and a queue would turn a burst into latency
that outlives the gesture. The SDK already sends at most one seek every 100ms,
always the latest.

There is no per-token request rate limit today. Do not build on that. A device
that polls REST to find out what changed is doing the socket's job badly, and a
limit will arrive the first time one misbehaves. Connect, and let the SDK keep
the copy current.

---

## Two properties of the system worth designing around

**All room state is per process.** Presence, room membership and transport
anchors live in memory, so the API does not run multi-instance without a
Socket.IO adapter. If you are told the deployment has grown, ask whether that
landed before assuming a device sees the same room as the gallery.

**Restarting the API clears every room.** The SDK reconnects, fetches and
rejoins on its own, and presence repopulates, but a playing transport stops,
because the anchor was in memory. A device should handle a transport that goes
quiet the same way it handles a pause.

A restart also moves the server's clock by a small amount. The SDK re-measures
on every connect and catches the jump, so nobody notices.

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

The SDK fetches on every connect, keeps the copy current, measures the clock,
answers **Sync clocks**, sends your socket id with writes, and stops on a dead
credential. What is left is yours:

1. Give the token the smallest role that does the job.
2. Handle `authFailed` and `incompatible`: show them on the device, and stop your
   process supervisor from restarting into the same dead token or the same
   outdated cino-sdk.
3. Alarm on `token` with days to spare, plan the 30-day rotation as an overlap,
   and rehearse it once before opening night.
4. Measure your hardware's latency and set `leadMs`.
5. Decide what a catch-up means for your equipment, and check `onBoundary`.
6. Send only the fields that change when you write.
7. Keep the process free of heavy work, and watch `stall`.
8. Show the connection, credential and clock state on the device itself:
   `live.connected`, `live.clock.synced` and `live.clock.errorMs`. The failure
   you cannot see is the one that ruins a show.

Building without the SDK? [The wire protocol](./protocol.md#checklist) has the
longer list.
