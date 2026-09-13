---
public: true
title: Overview
order: 0
---

# Integrating third-party equipment

How an installed device — a lighting desk, a playback machine, a show-control
box, a status display — authenticates against Cino and follows or edits a
timeline. Written for someone building that device, who has no browser, no
person sitting at it, and no interest in the rest of the product.

> **Status: specified, not yet built.** These pages are the contract the API
> token implementation is being written against. Nothing here answers on the
> server today. The design is stable enough to build a client against, but do
> not point production equipment at it until this notice is gone.

---

## Where to start

| Page | What it covers |
| --- | --- |
| [Authentication](./authentication.md) | The token model, getting one, and sending it |
| [Expiry and revocation](./lifecycle.md) | The 30-day lifetime, rotation, and killing a token |
| [Reading a timeline](./reading.md) | Bootstrapping, then following clips, tracks and the playhead |
| [Writing changes](./writing.md) | Creating and editing clips and tracks, and driving playback |
| [Limits and logging](./limits.md) | Rate limits, hard caps, and what gets audited |

---

## Why equipment gets tokens, not accounts

The obvious shortcut is to make a user account for the desk and log it in with
`POST /api/auth/login`. Do not do that, and the reasons are worth stating
because they are the whole design.

**A session belongs to a person.** It expires in 24 hours with a sliding
renewal, so a device that sits idle over a dark Monday wakes up logged out.
Keeping it alive means storing someone's password on the device forever.

**A password is not revocable in isolation.** Killing the desk's access means
changing a password that something else is probably also using, and you find
out which by breaking it.

**You cannot tell who did what.** Every action arrives as a person. When the
gallery does something surprising at 02:00, the log says a human did it.

A token fixes all three. It belongs to the *production*, not to whoever
installed it, so it keeps working when that person leaves the company. It is
named, so the log says `Lighting Desk` and not a person's name. And it dies on
its own after 30 days whether or not anyone remembers it exists.

---

## The shape of an integration

<figure class="diagram wide">
<svg viewBox="0 0 780 280" role="img" aria-label="A device fetches the whole timeline state over REST, then receives live changes over a socket, and sends its own writes back over REST.">
  <defs>
    <marker id="sh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="d-arrow" />
    </marker>
  </defs>

  <rect class="d-box" x="14" y="40" width="150" height="200" rx="12" />
  <text class="d-text" x="89" y="132" text-anchor="middle">your</text>
  <text class="d-text" x="89" y="152" text-anchor="middle">device</text>

  <rect class="d-box d-box--accent" x="616" y="40" width="150" height="200" rx="12" />
  <text class="d-text" x="691" y="142" text-anchor="middle">Cino API</text>

  <text class="d-label" x="190" y="58">1 · bootstrap</text>
  <line class="d-line" x1="190" y1="76" x2="610" y2="76" marker-end="url(#sh-arrow)" />
  <text class="d-step" x="190" y="96">GET /api/timeline/{id}</text>
  <text class="d-sub" x="606" y="96" text-anchor="end">the whole current state</text>

  <text class="d-label" x="190" y="140">2 · follow</text>
  <line class="d-line d-line--accent" x1="610" y1="158" x2="190" y2="158" marker-end="url(#sh-arrow)" />
  <text class="d-step" x="190" y="178">clip:change · track:change</text>
  <text class="d-step" x="190" y="198">transport:state</text>
  <text class="d-sub" x="606" y="178" text-anchor="end">over the socket</text>

  <text class="d-label" x="190" y="226">3 · write</text>
  <line class="d-line" x1="190" y1="244" x2="610" y2="244" marker-end="url(#sh-arrow)" />
  <text class="d-step" x="190" y="264">POST · PATCH · DELETE</text>
  <text class="d-sub" x="606" y="264" text-anchor="end">writes go over REST</text>
</svg>
</figure>

Three rules follow from that picture, and most integration bugs come from
missing one.

**Bootstrap over REST, always.** The socket carries changes, not state. A
client that builds its model from events alone is wrong from the first one it
misses, and it will miss one.

**Writes go over REST, never over the socket.** Nothing is saved by emitting an
event. The server persists the row and then relays it to the room itself.

**The server owns the playback clock.** Devices never stream positions. They
receive an anchor and derive the current frame from it, which is what makes a
command's network delay cancel out.

The reasoning behind all three is in the internal
[live updates](../realtime.md) page, which needs a sign-in.
