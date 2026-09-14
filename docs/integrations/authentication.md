---
public: true
title: Authentication
order: 1
---

# Authentication

> Part of the [integration guide](./index.md).

A token is issued **for one production** and carries **one production role**.
It has no access to anything outside that production — not the company, not
other productions, not the issuing user's account.

| | |
| --- | --- |
| Format | `cino_svc_<id>_<secret>` — `id` is 32 hex characters |
| Scope | exactly one production |
| Permissions | one production role, masked (see below) |
| Lifetime | **30 days** from creation |
| Revocation | immediate for REST; live sockets are closed straight away, and within 60s at worst |
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

If the role is deleted, the token keeps working as a credential but holds **no
permissions at all**. It fails visibly with `403`s rather than quietly picking up
someone else's access.

Give each device the smallest role that does its job. A device that only
follows the timeline, like the [camera switcher](../examples/camera-switcher.md),
needs nothing beyond `VIEW`.

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

The same rule holds for sockets. A token may connect to the live timeline only.
Chat between people is refused with `errors.auth.tokenNotPermitted`.

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

## Using the token

```ts
import { Cino } from 'cino-sdk';

const cino = new Cino({
  url: 'https://cino.no',            // the server that issued the token
  token: process.env.CINO_TOKEN!,
});
```

One `Cino` holds one token. Every REST call it makes sends the token as
`Authorization: Bearer …`, and `cino.connect()` sends it in the socket handshake.
It sends no cookies, and if a request ever carried both a session cookie and a
token, the token would win, so a misconfigured proxy cannot quietly upgrade a
device to a person's access.

A token belongs to the server that issued it. One made on a local development
server is refused by cino.no with `errors.auth.tokenInvalid`, and the other way
round, so point `url` at the server you created it on.

**Keep the token where visitors cannot reach it.** Put it in an environment
variable or a file only the device's service account can read, and never in
source control. A token inside a web page's JavaScript is a token anyone who
opens the page can copy. If your device's interface is a browser, keep the token
on a small server beside it, as the [control panel](../examples/control-panel.md)
does.

---

## When a request is refused

A refused request throws a `CinoApiError`:

```ts
import { CinoApiError } from 'cino-sdk';

try {
  await cino.timeline(timelineId).clips.create({ trackId, position: 1500, label: 'Cue 13' });
} catch (err) {
  if (!(err instanceof CinoApiError)) throw err;
  if (err.missingPermission) console.error(`the token's role needs ${err.missingPermission}`);
  else if (err.isAuth) console.error(`the token no longer works: ${err.errorKey}`);
  else if (err.status === 423) console.error('someone locked that track in the editor');
  else throw err;
}
```

| `status` | `errorKey` | Meaning |
| --- | --- | --- |
| 0 | — | The request never reached the server, or no response started within `timeoutMs` (30 seconds unless you set it) |
| 401 | `errors.auth.tokenInvalid` | Unknown, malformed, or revoked |
| 401 | `errors.auth.tokenExpired` | Past its 30 days |
| 401 | `errors.auth.tokenNotPermitted` | Valid, but this route is not on the allowlist |
| 403 | `errors.permission.missing` | Valid, but the role lacks the bit — `err.missingPermission` names it |
| 423 | `errors.track.locked` | Someone locked the track in the editor |

`err.isAuth` is true for every `errors.auth.*` key. `err.isFatal` is true when
sending the same request again cannot succeed: an auth failure, a `403` or a
`404`. Retry the rest with a backoff, and never retry a fatal one.

A revoked token answers `tokenInvalid`, not something more specific. Confirming
that a particular secret once existed would tell an attacker something.

---

## A live connection stops on a dead credential

A device hammering the handshake with a dead token is what takes an API instance
down on a show night, and the credential will not fix itself. So the SDK does
not retry one. When the handshake is refused with an `errors.auth.*` key, when
fetching the timeline answers `401`, `403` or `404`, or when the server sends
`access:revoked`, the connection closes for good and emits `authFailed`:

```ts
const live = cino.connect(timelineId);

live.on('authFailed', ({ errorKey, message }) => {
  showOnPanel(`Cino stopped: ${message}`);   // on the device's own display
  process.exitCode = 1;
});
```

Say so on the device itself, and make sure whatever supervises the process does
not simply start it again. Under systemd, give the exit code to
`RestartPreventExitStatus=`.

Every rejected token is written to the production's audit log with the reason
and the source address, so a device stuck retrying a dead token is easy to find.

Next: [expiry and revocation](./lifecycle.md).
