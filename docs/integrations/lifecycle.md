---
public: true
title: Expiry and revocation
order: 2
---

# Expiry and revocation

> Part of the [integration guide](./index.md).

Tokens live for **30 days**. That is short on purpose: an installed device that
nobody audits is exactly the credential that should not be permanent.

The practical consequence is that **rotation is part of the install**, not an
emergency response. Plan it before the device ships.

---

## Rotating with an overlap

Issue the replacement before the old one dies, write it to the device, then
revoke the old one. Both work at once, so there is no window where the device is
down. This is the only approach that is safe to run during a show.

<figure class="diagram">
<svg viewBox="0 0 780 170" role="img" aria-label="Token A is valid from day 0 to day 30. Token B is issued on day 23 and runs until day 53. Between day 23 and day 30 both work: move the device to token B in that window, then revoke token A.">
  <rect class="d-span" x="540" y="44" width="140" height="80" rx="6" />
  <text class="d-sub" x="80" y="28" text-anchor="middle">day 0</text>
  <text class="d-sub" x="540" y="28" text-anchor="middle">day 23</text>
  <text class="d-sub" x="680" y="28" text-anchor="middle">day 30</text>
  <line class="d-line d-line--dashed" x1="80" y1="36" x2="80" y2="132" />
  <line class="d-line d-line--dashed" x1="540" y1="36" x2="540" y2="132" />
  <line class="d-line d-line--dashed" x1="680" y1="36" x2="680" y2="84" />
  <rect class="d-bar" x="80" y="52" width="600" height="26" rx="13" />
  <text class="d-bar-label" x="96" y="70">token A</text>
  <text class="d-bar-label" x="664" y="70" text-anchor="end">expires</text>
  <rect class="d-bar d-bar--accent" x="540" y="90" width="224" height="26" rx="13" />
  <text class="d-bar-label" x="556" y="108">token B</text>
  <text class="d-bar-label" x="752" y="108" text-anchor="end">until day 53</text>
  <text class="d-sub" x="610" y="154" text-anchor="middle">both valid: move the device across, then revoke A</text>
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

This is one of the few places the wall clock is the right clock: the expiry is a
calendar date, and being a few seconds out does not matter. Playback timing is
the opposite case; see [clocks and timing](./timing.md).

---

## What expiry looks like mid-session

REST calls start answering `401` with `errors.auth.tokenExpired`. A socket that
is already connected is checked by a sweep that runs every 60 seconds. When the
sweep finds the token has expired, it sends `access:revoked` and closes the
socket. A reconnect then fails its handshake with `errors.auth.tokenExpired`.

Treat it exactly like revocation: stop reconnecting, and say so on the panel. A
device that silently retries forever is a device nobody notices is broken.

---

## Revocation

Revoking from the Integrations window takes effect immediately for new
requests. Every live socket holding the token is normally sent `access:revoked`
and closed at the same moment.

The **guarantee is 60 seconds**, not immediate. Capabilities are cached when a
socket joins a room, and the immediate close only reaches sockets held by the
API process that handled the revoke. The 60-second sweep is what still holds
when that is not the case. Build against the guarantee rather than against the
faster behaviour you will usually see.

The same sweep catches role edits and membership changes. A device whose role
loses `EDIT_TIMELINE` stops being able to write without anyone restarting
anything, and without the token itself being touched.

A revoked token answers `errors.auth.tokenInvalid` from then on, the same as a
token that never existed.

---

## Losing a secret

There is no recovery path, by design. Only the hash is stored, so revoke the
token and issue a new one. If the secret may have leaked rather than simply been
misplaced, revoke first and investigate afterwards — a revoked token costs you
one device for a few minutes, and a leaked one costs you the production.

Every issue and revoke is recorded in the production's audit log with the person
who did it. See [limits and logging](./limits.md#what-gets-logged).

Next: [reading a timeline](./reading.md).
