---
public: true
title: Writing changes
order: 4
---

# Writing clips and tracks

> Part of the [integration guide](./index.md). The token system is specified
> but not yet live on the server.

**Every write is a REST call.** Nothing is ever saved by emitting a socket
event. The server persists the row, then relays it to the room itself, so peers
usually see the change before your own HTTP response arrives.

All of these need `EDIT_TIMELINE` on the token's role. Relabelling a clip also
accepts the narrower `RENAME_CLIPS`.

---

## A request helper

```js
const api = (path, init = {}) => fetch(`${BASE}/api${path}`, {
  ...init,
  headers: {
    Authorization: `Bearer ${process.env.CINO_TOKEN}`,
    'Content-Type': 'application/json',
    'x-socket-id': socket.id,          // see below
    ...init.headers,
  },
}).then(async (res) => {
  if (!res.ok) throw Object.assign(new Error(`${res.status}`), await res.json());
  return res.status === 204 ? null : res.json();
});
```

---

## Clips

```js
// Create — position is a frame number, trackId must belong to this timeline.
const clip = await api(`/timeline/${TIMELINE_ID}/clips`, {
  method: 'POST',
  body: JSON.stringify({
    trackId: 'trk_1',
    label: 'Cue 13',
    position: 1800,
    hue: 210,
  }),
});

// Update — send ONLY the fields you are changing.
await api(`/timeline/${TIMELINE_ID}/clips/${clip.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ position: 1850 }),
});

// Delete
await api(`/timeline/${TIMELINE_ID}/clips/${clip.id}`, { method: 'DELETE' });
```

Partial patches are not a style preference. Two devices editing one clip write
different columns, and whoever sends a whole row silently undoes the other's
edit to a field it never meant to touch. Send the delta.

Optional clip fields: `fileId`, `mediaStart`, `end`, `sourceId`, `hue`, and a
`data` object capped at 2 KB of JSON. When both are set, `end` must be greater
than `mediaStart`.

---

## Tracks

```js
// Create — typeId must be one of the production's track types.
const track = await api(`/timeline/${TIMELINE_ID}/tracks`, {
  method: 'POST',
  body: JSON.stringify({ typeId: 'typ_1', name: 'Lighting', icon: 'mdi:lightbulb' }),
});

// Update — name, icon, isMuted, isLocked, sourceId, sortOrder
await api(`/timeline/${TIMELINE_ID}/tracks/${track.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ isMuted: true }),
});

// Reorder — index in the array becomes sortOrder
await api(`/timeline/${TIMELINE_ID}/tracks/reorder`, {
  method: 'POST',
  body: JSON.stringify({ order: ['trk_2', 'trk_1', 'trk_3'] }),
});

await api(`/timeline/${TIMELINE_ID}/tracks/${track.id}`, { method: 'DELETE' });
```

Reorder is deliberately lenient. Unknown ids are ignored and omitted tracks keep
their position, so a concurrent add or delete by someone in the editor does not
fail the whole call.

A locked track rejects writes with `423`. The lock is a collaboration signal,
not a permission — someone in the editor is asking to be left alone. Surface it
rather than retrying.

---

## Not receiving your own writes

Send your socket id on mutating requests and the relay skips you:

```
x-socket-id: <socket.id>
```

Without it your own change comes back as a `clip:change`, which is harmless but
wasteful, and will fight any optimistic state you keep. The header is optional
everywhere: a device with no socket open simply omits it.

---

## Driving playback

Transport commands are the one thing that does go over the socket, because they
are a request to the room's clock rather than a row to persist:

```js
socket.emit('transport:command', { action: 'play',  frame: 1500 });
socket.emit('transport:command', { action: 'seek',  frame: 2000 });
socket.emit('transport:command', { action: 'pause' });
```

`pause` takes no frame. The server computes the stop position from its own
clock, so every client stops on the same one.

Seeks are rate-bounded per socket, and excess commands are dropped rather than
queued. See [limits](./limits.md).
