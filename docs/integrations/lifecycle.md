---
public: true
title: Expiry and revocation
order: 2
---

# Expiry and revocation

> Part of the [integration guide](./index.md). The token system is specified
> but not yet live on the server.

Tokens live for **30 days**. That is short on purpose: an installed device that
nobody audits is exactly the credential that should not be permanent.

The practical consequence is that **rotation is part of the install**, not an
emergency response. Plan it before the device ships.

---

## Rotating with an overlap

Issue the replacement before the old one dies, write it to the device, then
revoke the old one. Both work at once, so there is no window where the device is
down. This is the only approach that is safe to run during a show.

<figure class="diagram wide">
<svg viewBox="0 0 760 168" role="img" aria-label="Token A is valid from day 0 to day 30. Token B is issued on day 23, so for seven days both work. The device is moved to token B during that window, and token A is revoked afterwards.">
  <!-- The overlap is the whole point of the picture, so it is drawn first and
       sits behind both bars rather than competing with them. -->
  <rect class="d-span" x="560" y="46" width="120" height="74" rx="6" />

  <text class="d-sub" x="80" y="28" text-anchor="middle">day 0</text>
  <text class="d-sub" x="560" y="28" text-anchor="middle">day 23</text>
  <text class="d-sub" x="680" y="28" text-anchor="middle">day 30</text>

  <line class="d-line d-line--dashed" x1="80" y1="36" x2="80" y2="128" />
  <line class="d-line d-line--dashed" x1="560" y1="36" x2="560" y2="128" />
  <line class="d-line d-line--dashed" x1="680" y1="36" x2="680" y2="128" />

  <rect class="d-bar" x="80" y="52" width="600" height="26" rx="13" />
  <text class="d-bar-label" x="96" y="70">token A</text>
  <text class="d-bar-label" x="664" y="70" text-anchor="end">expires</text>

  <rect class="d-bar d-bar--accent" x="560" y="88" width="180" height="26" rx="13" />
  <text class="d-bar-label" x="576" y="106">token B</text>

  <text class="d-sub d-accent" x="620" y="146" text-anchor="middle">both valid — move the device across here</text>
</svg>
</figure>

Rehearse it once, on a quiet morning, before you need it.

---

## Knowing the deadline

Every authenticated response carries the token's expiry, so a device can warn
before it is locked out rather than after:

```
X-Cino-Token-Expires: 2026-10-12T09:14:00.000Z
```

Read it and act on it. A device that alarms at seven days left, on its own
panel, turns a dead show into a Tuesday morning task.

```js
const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

const expires = res.headers.get('X-Cino-Token-Expires');
if (expires) {
  const daysLeft = (Date.parse(expires) - Date.now()) / 86_400_000;
  if (daysLeft < 7) raiseLocalAlarm(`Cino token expires in ${Math.floor(daysLeft)} days`);
}
```

---

## What expiry looks like mid-session

REST calls start answering `401` with `errors.auth.tokenExpired`. Live sockets
are closed at the next revalidation sweep, within 60 seconds.

Treat it exactly like revocation: stop reconnecting, and say so on the panel. A
device that silently retries forever is a device nobody notices is broken.

---

## Revocation

Revoking from the Integrations window takes effect immediately for new
requests. Live sockets are closed within **60 seconds**, because capabilities
are cached when a socket joins a room and re-resolved on an interval.

Sixty seconds is the guarantee the server will keep, so build against it rather
than against the faster behaviour you may observe in practice.

The same sweep catches role edits and membership changes. A device whose role
loses `EDIT_TIMELINE` stops being able to write without anyone restarting
anything, and without the token itself being touched.

---

## Losing a secret

There is no recovery path, by design. Only the hash is stored, so revoke the
token and issue a new one. If the secret may have leaked rather than simply been
misplaced, revoke first and investigate afterwards — a revoked token costs you
one device for a few minutes, and a leaked one costs you the production.
