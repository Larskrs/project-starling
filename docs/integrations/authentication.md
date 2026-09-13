---
public: true
title: Authentication
order: 1
---

# Authentication

> Part of the [integration guide](./index.md). The token system is specified
> but not yet live on the server.

A token is issued **for one production** and carries **one production role**.
It has no access to anything outside that production — not the company, not
other productions, not the issuing user's account.

| | |
| --- | --- |
| Format | `cino_svc_<id>_<secret>` |
| Scope | exactly one production |
| Permissions | one production role, masked (see below) |
| Lifetime | **30 days** from creation |
| Revocation | immediate for new requests, within 60s on live sockets |
| Storage | SHA-256 of the secret; the plaintext is never stored |

The `id` segment is the token's row id. It lets the server find the row with one
indexed lookup before doing any hashing, and it is what the management window
shows so a token is identifiable without revealing its secret.

---

## Permissions are a role, and the role is capped

Tokens reuse the production role system rather than inventing a parallel scope
vocabulary. Give the desk a role called `Playback` holding `EDIT_TIMELINE`, and
it can do exactly what a human holding that role can do. No more, and no
separate list to keep in sync.

Three permissions can never be held by a token, whatever the role says:

```
ADMINISTRATOR      MANAGE_MEMBERS      MANAGE_ROLES
```

The mask is applied when access is resolved, not when the token is created, so
editing the role later cannot widen the token. A device must never be able to
grant access, and `ADMINISTRATOR` passes every other check by design.

---

## What a token cannot reach

Access is an **allowlist**, not a blocklist. A token reaches the timeline,
track, clip and production-scoped storage routes for its own production.
Everything else answers `401` with `errorKey: "errors.auth.tokenNotPermitted"`,
including the account-shaped routes: `/api/user/me`, `/api/production/list`,
`/api/companies`, `/api/activity/recent`.

This matters more than it looks. Several of those routes filter by the caller's
user id rather than by a production, so a token allowed through would report on
the account of whoever issued it.

---

## Getting a token

Production settings → **Integrations** → *New token*. Opening that page needs
`ADMINISTRATOR` on the production.

Choose a label and a role. The label appears in every log line and in the live
room's presence list, so name it after the physical thing: `FOH Lighting Desk`,
`Stage Left Playback`. Not `token 3`.

**The secret is shown exactly once.** Only its hash is stored, so nobody —
including support — can recover it afterwards. If it is lost, revoke the token
and issue a new one. That is a two-minute job and the only safe answer.

The same page lists every live token with its label, role, creator, expiry and
last-used time, plus a revoke button. Last-used is the column that earns its
keep: it is how you find the tokens nobody remembers issuing.

---

## Sending the token over REST

```
Authorization: Bearer cino_svc_8f2c1a94_R7pQ...
```

```bash
curl -s "https://cino.no/api/timeline/$TIMELINE_ID" \
  -H "Authorization: Bearer $CINO_TOKEN"
```

Send no cookies. If a request carries both a session cookie and a bearer token
the token wins, so a misconfigured proxy cannot quietly upgrade a device to a
person's access.

## Sending the token over Socket.IO

The token goes in the handshake `auth` payload, not in a header. Browsers
cannot set headers on a WebSocket upgrade, and one form means one code path on
the server.

```js
import { io } from 'socket.io-client';

const socket = io('https://cino.no/timeline', {
  path: '/socket',
  transports: ['websocket'],
  auth: { token: process.env.CINO_TOKEN },
});
```

Native clients send no `Origin` header. The server's allowlist permits that
explicitly, so there is no CORS configuration to do.

---

## Failure shapes

| Status | `errorKey` | Meaning |
| --- | --- | --- |
| 401 | `errors.auth.tokenInvalid` | Unknown, malformed, or revoked |
| 401 | `errors.auth.tokenExpired` | Past its 30 days |
| 401 | `errors.auth.tokenNotPermitted` | Valid, but this route is not on the allowlist |
| 403 | `errors.permission.missing` | Valid, but the role lacks the bit — `data.missingPermission` names it |
| 423 | `errors.track.locked` | Someone locked the track in the editor |
| 429 | `errors.generic.rateLimited` | See [limits](./limits.md) |

On a socket, a handshake failure arrives as `connect_error` with one of the same
keys as its message.

**Do not reconnect in a tight loop on `tokenInvalid` or `tokenExpired`.** The
credential will not fix itself, and a device hammering the handshake is what
takes an API instance down on a show night. Back off to minutes and surface the
state on the device's own display.

```js
socket.on('connect_error', (err) => {
  if (String(err.message).startsWith('errors.auth.')) {
    socket.disconnect();
    console.error('auth failed, not retrying:', err.message);
  }
});
```
