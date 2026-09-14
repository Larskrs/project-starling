---
public: true
title: Overview
order: 0
---

# Integrating third-party equipment

How an installed device — a lighting desk, a vision mixer, a playback machine, a
status display — authenticates against Cino and follows or edits a timeline.
Written for someone building that device, who has no browser, no person sitting
at it, and no interest in the rest of the product.

The guide is built on **cino-sdk**, the SDK for Cino. It runs in Node.js 20 or
later and in browsers, and it does the parts of an integration that are easy to
get subtly wrong: fetching the timeline on every connect, measuring the server's
clock, announcing clip changes on the frame, and stopping on a dead credential.
What is left is what your device adds: deciding what a change means, and doing
something with it.

If your device cannot run JavaScript, [the wire protocol](./protocol.md)
describes everything the SDK does, so you can do the same in another language.

---

## Quick start

```sh
npm install cino-sdk
```

```ts
import { Cino } from 'cino-sdk';

const cino = new Cino({ url: 'https://cino.no', token: process.env.CINO_TOKEN! });
const live = cino.connect(process.env.CINO_TIMELINE!);

live.on('ready', ({ timeline }) => console.log(`following ${timeline.name}`));
live.on('authFailed', ({ message }) => console.error(`stopped: ${message}`));

live.onTrack('Cameras', ({ clip, frame }) => {
  const camera = live.source(clip?.sourceId)?.shortName ?? 'nothing';
  console.log(`${live.timecode(frame)} cut to ${camera}`);
});
```

The token comes from the production's settings under **Integrations**, as
[authentication](./authentication.md) describes. The timeline's id is the last
part of the editor's address, after `/editor/`.

For complete devices — a camera switcher, a stage manager's control panel, and
lighting and sound cues — see the [examples](../examples/index.md).

---

## Where to start

Read the pages in order the first time. Each one assumes the ones before it.

| Page | What it covers |
| --- | --- |
| [Authentication](./authentication.md) | The token model, getting one, and what a refusal looks like |
| [Expiry and revocation](./lifecycle.md) | The 30-day lifetime, rotation, and killing a token |
| [Following a timeline](./reading.md) | Snapshots, connecting, the local copy, clip events and the playhead |
| [Clocks and timing](./timing.md) | How clip events and cues land on the frame, and what that needs from you |
| [Writing changes](./writing.md) | Editing clips and tracks, driving playback, and setting up a production |
| [Limits and logging](./limits.md) | Hard caps, what gets audited, and a checklist before you ship |
| [The wire protocol](./protocol.md) | Everything the SDK does, for devices that cannot run it |

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

<figure class="diagram">
<svg viewBox="0 0 780 290" role="img" aria-label="Three flows between a device running cino-sdk and the Cino API. First the SDK fetches the whole timeline state over REST. Then it follows clip, track and transport events over the socket. The device's own writes go back over REST.">
  <defs>
    <marker id="sh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="d-arrow" />
    </marker>
    <marker id="sh-arrow-accent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="d-arrow d-accent" />
    </marker>
  </defs>
  <rect class="d-box" x="14" y="24" width="150" height="242" rx="12" />
  <text class="d-text" x="89" y="139" text-anchor="middle">your device</text>
  <text class="d-sub" x="89" y="159" text-anchor="middle">cino-sdk</text>
  <rect class="d-box d-box--accent" x="616" y="24" width="150" height="242" rx="12" />
  <text class="d-text" x="691" y="149" text-anchor="middle">Cino API</text>
  <text class="d-label" x="190" y="52">1 · fetch</text>
  <text class="d-sub" x="606" y="52" text-anchor="end">the whole state, on every connect</text>
  <text class="d-step" x="190" y="92">cino.connect(timelineId)</text>
  <text class="d-label" x="190" y="134">2 · follow</text>
  <text class="d-sub" x="606" y="134" text-anchor="end">over the socket</text>
  <text class="d-step" x="190" y="174">clip · change · transport</text>
  <text class="d-label" x="190" y="216">3 · write</text>
  <text class="d-sub" x="606" y="216" text-anchor="end">over REST, relayed by the server</text>
  <text class="d-step" x="190" y="256">live.clips.create · update · remove</text>
  <g>
    <path class="d-line" d="M168,68 L610,68" marker-end="url(#sh-arrow)" />
    <path class="d-line d-line--accent" d="M612,150 L170,150" marker-end="url(#sh-arrow-accent)" />
    <path class="d-line" d="M168,232 L610,232" marker-end="url(#sh-arrow)" />
  </g>
</svg>
</figure>

Four rules sit behind that diagram. The SDK follows all of them, and knowing
them explains what it does.

**The socket carries changes, not state.** A client that builds its copy from
events alone is wrong from the first one it misses, and it will miss one. The
SDK fetches the whole timeline over REST on every connect before it trusts an
event.

**Writes go over REST, never over the socket.** Nothing is saved by emitting an
event. The server persists the row and then relays it to the room itself.

**The server owns the playback clock.** Devices never stream positions. They
receive an anchor and work out the current frame from it, which is what makes a
command's network delay cancel out.

**Time is the server's time.** Working out a frame from the anchor only works if
the device knows what time it is *on the server*, measured over the socket and
never taken from the device's own wall clock. [Clocks and timing](./timing.md)
covers how.

The reasoning behind the first three is in the internal
[live updates](../realtime.md) page, which needs a sign-in.
