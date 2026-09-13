---
public: true
title: Clocks and timing
order: 4
---

# Clocks and timing

> Part of the [integration guide](./index.md).

A device following the playhead is only as accurate as its idea of what time it
is **on the server**. This page explains how that is measured, why it has to be
read from a monotonic clock, and how to keep it right through a whole show: over
a slow network, across reconnects, and after the device has been asleep. It ends
with a complete integration that cuts a vision mixer to the right camera on the
right frame.

If you only display which cue is live, [the one formula](#the-one-formula) is
enough. Anything that fires equipment on a frame should read the whole page.

---

## The one formula

Every playhead position comes from the room's anchor and the server's clock:

```
frame now = anchor.frame + (serverNow − anchor.at) / 1000 × anchor.frameRate
```

`anchor.at` is a reading of the **server's** clock. Your device cannot read that
clock, so it estimates it from its own clock plus a measured offset:

```
serverNow = localNow + offset
```

The rest of this page is about measuring `offset`, choosing `localNow`, and
keeping both honest.

One rule comes before all of it. **Keep `anchor.at` exactly as it arrived, and
do the conversion every time you read the position.** Do not turn it into local
time once and store that. The offset gets better over the first second of a
session and keeps being corrected after that, and a stored conversion freezes
whatever error the offset had when the anchor landed. For a device joining a
room that is already playing, that is the first ping, which is the worst one.
The web editor used to do exactly this, and a joiner stayed a few frames off the
room until somebody next pressed play.

---

## Measuring the offset

`time:ping` is an acknowledged event. Send it with no payload, and the
acknowledgement carries the server's clock reading in milliseconds:

```js
const t0 = localNow();
socket.timeout(2000).emit('time:ping', (err, serverTime) => {
  if (err) return;                 // a lost ping is just a missing sample
  addSample(t0, localNow(), serverTime);
});
```

<figure class="diagram">
<svg viewBox="0 0 780 220" role="img" aria-label="A ping leaves the device at t0 and its reply lands at t2. The server read its clock, serverTime, at some moment in between, so the true offset lies inside the window from t0 to t2, and the estimate is off by at most half the round trip.">
  <defs>
    <marker id="pw-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="d-arrow" />
    </marker>
    <marker id="pw-arrow-accent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="d-arrow d-accent" />
    </marker>
  </defs>
  <rect class="d-span" x="160" y="60" width="440" height="90" />
  <text class="d-label" x="20" y="64">device</text>
  <text class="d-label" x="20" y="154">server</text>
  <line class="d-line d-line--dashed" x1="100" y1="60" x2="760" y2="60" />
  <line class="d-line d-line--dashed" x1="100" y1="150" x2="760" y2="150" />
  <text class="d-sub" x="380" y="30" text-anchor="middle">rtt = t2 − t0</text>
  <text class="d-step" x="160" y="46" text-anchor="middle">t0</text>
  <text class="d-step" x="600" y="46" text-anchor="middle">t2</text>
  <text class="d-step" x="380" y="176" text-anchor="middle">serverTime</text>
  <text class="d-sub" x="380" y="206" text-anchor="middle">the server's reading happened somewhere inside the shaded window</text>
  <g>
    <path class="d-line" d="M160,60 L376,148" marker-end="url(#pw-arrow)" />
    <path class="d-line d-line--accent" d="M384,148 L597,62" marker-end="url(#pw-arrow-accent)" />
  </g>
  <circle class="d-arrow" cx="160" cy="60" r="4" />
  <circle class="d-arrow" cx="380" cy="150" r="4" />
  <circle class="d-arrow" cx="600" cy="60" r="4" />
</svg>
</figure>

The server read its clock at some moment between your `t0` and `t2`. You know
nothing more than that, and you need nothing more:

```
rtt    = t2 − t0
offset = serverTime + rtt / 2 − t2     // best guess: the trip was symmetric
error  ≤ rtt / 2                       // guaranteed, whatever the network did
```

The error bound is not an assumption about the network. For every ping that was
ever answered, the true offset lies between `serverTime − t2` and
`serverTime − t0`. A 20ms round trip pins it to within 10ms. A 400ms round trip
only pins it to within 200ms.

**So keep the sample with the lowest round trip, and do not average.** Latency
only ever adds. A slow ping is slow because it waited in a queue, usually in
one direction, and that one-sided wait is exactly what skews its estimate.
Averaging it with a clean sample makes the clean sample worse.

---

## Which clock to read

Use a **monotonic** clock for `localNow`, never the wall clock.

A wall clock (`Date.now()`, `time.time()`, `System.currentTimeMillis()`) gets
corrected whenever the operating system syncs with a time server, and changed
outright when someone sets the time. Each correction moves `localNow` without
moving the server, so the offset is wrong by the size of the jump until you
next measure, and so is the playhead. A monotonic clock only counts forward, so
that cannot happen. Its starting point is arbitrary, which does not matter: the
offset absorbs it.

| Platform | Monotonic clock, in ms | Keeps counting while asleep |
| --- | --- | --- |
| Browser, Node.js | `performance.timeOrigin + performance.now()` | Varies by browser and OS |
| Swift | `CACurrentMediaTime() * 1000` | No |
| Android | `SystemClock.elapsedRealtime()` | Yes |
| Linux, C | `clock_gettime(CLOCK_MONOTONIC)` | No; `CLOCK_BOOTTIME` does |
| Python | `time.monotonic() * 1000` | Depends on the OS |

The last column matters for anything that sleeps. A clock that stands still
while the device is suspended wakes up behind the server by the length of the
nap. [Keep measuring](#keep-measuring) covers how to catch that.

Timers need the same care. `setTimeout` and its equivalents count elapsed time,
not wall time, so a timer set for "400ms from now" is unaffected by a wall-clock
correction. Compute the delay from the monotonic estimate and hand it to the
timer, and the two agree.

The server stamps `at`, and answers `time:ping`, from a monotonic clock of its
own. Its readings look like Unix epoch milliseconds, but they are not wall-clock
time. They drift away from it over the server's uptime and snap back, in a small
jump, when the API restarts. Never format `at` as a date and never compare it
with a wall clock. Only compare it with your estimate of `serverNow`.

---

## Keep measuring

One measurement at connect is not enough for a device that runs all night. The
web editor re-measures on this schedule, and a device should do the same:

| When | Pings | Why |
| --- | --- | --- |
| Every connect and reconnect | 5, 120ms apart | Nothing is known yet, or the network path changed |
| After the upgrade to WebSocket | 5 | Samples taken over HTTP long-polling are lopsided |
| Every 15 seconds | 1 | Two clocks drift apart by up to a few ms a minute |
| On waking, or when the network returns | 5 | The monotonic clock may have stood still |

Keep samples from the last **2 minutes**, at most 24 of them, and use the one
with the lowest round trip. Drop older samples even when their round trip was
better. The two clocks tick at slightly different rates, so an old sample
describes an offset that is no longer quite true.

If your network never lets the connection upgrade to WebSocket, every sample
travels over long-polling. That still works, and the lowest round trip still
wins, but expect the estimate to be looser.

### Catching a clock that jumped

The error bound gives you a free consistency check. Against two clocks that
both kept running, two samples can never disagree by more than half their round
trips added together:

```
|offsetA − offsetB|  ≤  (rttA + rttB) / 2  +  10ms slack
```

When a new sample breaks that against an older one, one of the clocks moved:
the device slept, or the API restarted. Throw away every older sample it
disagrees with and adopt the new estimate straight away. Without this check the
old sample, with its better round trip, would outvote the truth for up to two
minutes.

### Correcting without a twitch

When the estimate moves by more than **40ms** (a frame at 25fps), jump straight
to it, because being right matters more than being smooth. For anything smaller,
move towards the new value at no more than **5ms per second**. A routine
re-measurement then never makes the playhead flicker or a cue fire twice, and
nobody sees the correction happen.

Every answered ping goes through the same steps:

<figure class="diagram">
<svg viewBox="0 0 700 640" role="img" aria-label="Flowchart. When a ping is answered, measure its round trip and offset. If it contradicts older samples, a clock jumped: drop those samples and apply the estimate at once. Otherwise take the lowest round trip from the last two minutes; if the estimate moved more than 40ms apply it at once, else glide towards it at up to 5ms per second. Either way, server time is local time plus the offset.">
  <defs>
    <marker id="smp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="d-arrow" />
    </marker>
    <marker id="smp-arrow-accent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="d-arrow d-accent" />
    </marker>
  </defs>
  <g>
    <path class="d-line" d="M220,54 L220,86" marker-end="url(#smp-arrow)" />
    <path class="d-line" d="M220,164 L220,194" marker-end="url(#smp-arrow)" />
    <path class="d-line" d="M325,232 L448,232" marker-end="url(#smp-arrow)" />
    <path class="d-line" d="M220,268 L220,300" marker-end="url(#smp-arrow)" />
    <path class="d-line" d="M560,260 L560,400" marker-end="url(#smp-arrow)" />
    <path class="d-line" d="M220,358 L220,390" marker-end="url(#smp-arrow)" />
    <path class="d-line" d="M330,430 L448,430" marker-end="url(#smp-arrow)" />
    <path class="d-line" d="M220,468 L220,496" marker-end="url(#smp-arrow)" />
    <path class="d-line d-line--accent" d="M220,546 L220,580" marker-end="url(#smp-arrow-accent)" />
    <path class="d-line d-line--accent" d="M560,458 L560,604 L372,604" marker-end="url(#smp-arrow-accent)" />
  </g>
  <g>
    <rect class="d-box" x="120" y="14" width="200" height="40" rx="20" />
    <text class="d-text" x="220" y="38.2" text-anchor="middle">a ping is answered</text>
    <rect class="d-box" x="70" y="88" width="300" height="76" rx="10" />
    <text class="d-text" x="220" y="112.2" text-anchor="middle">measure the sample</text>
    <text class="d-step" x="220" y="130.5" text-anchor="middle">rtt = t2 − t0</text>
    <text class="d-step" x="220" y="148.5" text-anchor="middle">offset = serverTime + rtt/2 − t2</text>
    <polygon class="d-box" points="220,196 325,232 220,268 115,232" />
    <text class="d-text" x="220" y="236.2" text-anchor="middle">consistent?</text>
    <rect class="d-box" x="450" y="204" width="220" height="56" rx="10" />
    <text class="d-text" x="560" y="228.2" text-anchor="middle">a clock jumped</text>
    <text class="d-sub" x="560" y="245.0" text-anchor="middle">drop the samples it contradicts</text>
    <rect class="d-box" x="70" y="302" width="300" height="56" rx="10" />
    <text class="d-text" x="220" y="326.2" text-anchor="middle">take the lowest round trip</text>
    <text class="d-sub" x="220" y="343.0" text-anchor="middle">from the last 2 minutes, at most 24</text>
    <polygon class="d-box" points="220,392 330,430 220,468 110,430" />
    <text class="d-text" x="220" y="434.2" text-anchor="middle">moved over 40ms?</text>
    <rect class="d-box" x="450" y="402" width="220" height="56" rx="10" />
    <text class="d-text" x="560" y="426.2" text-anchor="middle">apply it at once</text>
    <text class="d-sub" x="560" y="443.0" text-anchor="middle">right beats smooth</text>
    <rect class="d-box" x="70" y="498" width="300" height="48" rx="10" />
    <text class="d-text" x="220" y="526.2" text-anchor="middle">glide at up to 5ms per second</text>
    <rect class="d-box d-box--accent" x="70" y="582" width="300" height="44" rx="22" />
    <text class="d-step" x="220" y="608.0" text-anchor="middle">serverNow = localNow + offset</text>
  </g>
  <g>
    <text class="d-sub" x="386.5" y="225" text-anchor="middle">no</text>
    <text class="d-sub" x="228" y="283" text-anchor="start">yes</text>
    <text class="d-sub" x="389" y="423" text-anchor="middle">yes</text>
    <text class="d-sub" x="228" y="483" text-anchor="start">no</text>
  </g>
</svg>
</figure>

---

## Syncing on request

Before a show starts, an operator presses **Sync clocks** in the editor. The
server asks every client in the room, editors and devices alike, to re-measure
its clock and report back. **Any Play pressed meanwhile is held** until every
client has answered, so nobody starts the show on an estimate that is still
being refined.

Your device takes part by answering one event:

```js
socket.on('clock:measure', async ({ requestId }) => {
  await clock.measure();                                         // a fresh burst
  socket.emit('clock:report', { requestId, rtt: clock.rtt });   // null if no ping answered
});
```

- **Answer within `deadlineMs`, which is 4 seconds.** A device that does not is
  listed as *did not answer* in the editor, and the Play goes ahead without it.
  Nothing a device does can hold the room past the deadline.
- **Measure afresh.** Start a new burst after the request arrives. If a burst is
  already under way, let it finish and then run another, because its first pings
  were sent before anyone asked.
- **`rtt` is the round trip of the sample your estimate rests on**, so your
  offset is good to half of it. The operator sees `±rtt/2` next to your device's
  name, and anything looser than one frame is flagged.
- **Report `rtt: null` when no ping answered.** That tells the operator the one
  thing they need to know before starting: this device has no server time.
- **Listening to `clock:status` is optional.** It carries the run's progress for
  every client, which is useful if your device has a panel to show it on.

A held Play starts the moment the last client answers, on an anchor stamped at
that moment. It reaches you as an ordinary `transport:state`, so a device that
follows the playhead as described on this page needs nothing else.

### The events

| Direction | Event | Payload |
| --- | --- | --- |
| anyone → server | `clock:resync` | `{}`, acknowledged with `{ ok: true, requestId }` |
| server → every client | `clock:measure` | `{ requestId, deadlineMs }` |
| you → server | `clock:report` | `{ requestId, rtt }`, with `rtt` in milliseconds or `null` |
| server → every client | `clock:status` | the run's progress, below |

```jsonc
{
  "requestId": "4f0c2a…",
  "state": "measuring",               // then "done"
  "requestedBy": { "id": "…", "name": "Stage manager" },
  "startedAt": 1726221450123.4,       // server clock, like a transport anchor's `at`
  "finishedAt": null,
  "deadlineMs": 4000,
  "playHeld": true,                   // a Play starts the moment this run ends
  "clients": [
    { "socketId": "…", "id": "token:…", "name": "Vision mixer", "state": "synced", "rtt": 18 },
    { "socketId": "…", "id": "…", "name": "Lighting desk", "state": "waiting", "rtt": null }
  ]
}
```

A client's `state` is `waiting`, `synced`, `failed` (no ping got through),
`no-report` (the deadline passed first) or `left`. There is one entry per socket,
so a device with two connections appears twice. A report only counts if its
`requestId` matches the run in progress and it comes from a socket that was
asked. Anything else is ignored, including a second report from the same socket.

A device may send `clock:resync` itself, with the same access it needs to send
transport commands. A playback server that wants to be sure before it presses
Play is the usual reason. Sending it while a run is going joins that run rather
than starting another.

---

## Joining a room that is already playing

The server answers `timeline:join` with the anchor straight away, and that
answer usually arrives **before** your first ping comes back. Do not read the
position yet. Without an offset, `serverNow` is just your own clock, and the
playhead lands wherever the difference between the two clocks puts it.

Hold off until the first sample arrives, then start reading. Because you convert
at read time, the position tightens up on its own as better samples come in,
and nothing has to be re-sent.

If no ping ever answers, do not fall back to guessing. Show that the device has
no server time on its own panel. A device quietly running a few seconds off is
worse than one that says it cannot follow.

---

## The clock, in code

Everything above, for a JavaScript device. It depends only on `socket.io-client`,
and the web editor runs the same algorithm with the same constants.

```js
// serverClock.js
const BURST = 5, GAP_MS = 120, EVERY_MS = 15_000;
const MAX_AGE_MS = 120_000, MAX_SAMPLES = 24, SLACK_MS = 10;
const STEP_MS = 40, SLEW_MS_PER_S = 5;

export const localNow = () => performance.timeOrigin + performance.now();

export function createServerClock(socket) {
  let samples = [];
  let target = null, from = 0, since = 0;   // applied offset glides from `from` towards `target`
  let current = null;                        // the burst under way; concurrent callers share it

  function offsetAt(t) {
    if (target === null) return null;
    const room = (SLEW_MS_PER_S * (t - since)) / 1000;
    return from + Math.max(-room, Math.min(room, target - from));
  }

  function addSample(t0, t2, serverTime) {
    const rtt = t2 - t0;
    const s = { offset: serverTime + rtt / 2 - t2, rtt, at: t2 };

    const fresh = samples.filter(o => s.at - o.at <= MAX_AGE_MS);
    const agree = fresh.filter(o => Math.abs(o.offset - s.offset) <= (o.rtt + s.rtt) / 2 + SLACK_MS);
    samples = [...agree, s].slice(-MAX_SAMPLES);

    const best    = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    const current = offsetAt(t2);
    const jumped  = agree.length < fresh.length;
    from   = current === null || jumped || Math.abs(best.offset - current) > STEP_MS ? best.offset : current;
    since  = t2;
    target = best.offset;
  }

  function ping() {
    return new Promise((resolve) => {
      if (!socket.connected) return resolve();
      const t0 = localNow();
      socket.timeout(2000).emit('time:ping', (err, serverTime) => {
        if (!err) addSample(t0, localNow(), serverTime);
        resolve();
      });
    });
  }

  function burst() {
    current ??= (async () => {
      for (let i = 0; i < BURST; i++) {
        await ping();
        if (i < BURST - 1) await new Promise(r => setTimeout(r, GAP_MS));
      }
    })().finally(() => { current = null; });
    return current;
  }

  socket.on('connect', () => {
    burst();
    const engine = socket.io.engine;
    if (engine.transport.name !== 'websocket') engine.once('upgrade', () => burst());
  });
  setInterval(() => { if (!current) ping(); }, EVERY_MS);

  return {
    /** False until the first ping has answered. Do not read positions before. */
    get synced() { return target !== null; },
    /** Round trip of the best sample; the offset is good to half this. Null before any. */
    get rtt() { return samples.length ? Math.min(...samples.map(s => s.rtt)) : null; },
    /** The server's clock right now. */
    now() { const t = localNow(); return t + (offsetAt(t) ?? 0); },
    /** Call when the device wakes or its network comes back. */
    burst,
    /** A burst that starts after this call, for `clock:measure`. Resolves when it is done. */
    async measure() { if (current) await current; await burst(); },
  };
}
```

Create it before the socket connects, so the first burst starts with the
connection.

---

## Worked example: cutting cameras on the frame

A device that drives a vision mixer. One track on the timeline is the camera
script: each clip on it has a source, and each source has a short code, such as
`C1`, `C2` or `CRN`, set in the production's sources. When the playhead enters a
clip, the mixer cuts to the input mapped to that clip's source code.

### Why the device works out the cut itself

The server does not announce clip changes. It sends the anchor, the clips and
every edit, and leaves the arithmetic to the device. That is deliberate: an
event sent as a boundary passed would reach you late by the network, a frame or
two on a good connection and more over long-polling, so a camera change would
always land after the script says. The only place a boundary can be known in
time is the device itself, which already holds every clip and the anchor. The
next boundary is a subtraction.

### How it works

<figure class="diagram">
<svg viewBox="0 0 700 646" role="img" aria-label="Flowchart of one tick of the camera loop, every 20ms. If the clock is not synced or the room is not playing, cancel any timer. Otherwise read the playhead, cut to the live camera if it changed, and check whether the next clip boundary is under 40ms away. If not, wait for the next tick. If it is, arm a one-shot timer for the milliseconds left minus the mixer latency; when it fires the mixer cuts on the frame.">
  <defs>
    <marker id="cam-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="d-arrow" />
    </marker>
    <marker id="cam-arrow-accent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" class="d-arrow d-accent" />
    </marker>
  </defs>
  <g>
    <path class="d-line" d="M220,54 L220,85" marker-end="url(#cam-arrow)" />
    <path class="d-line" d="M340,126 L438,126" marker-end="url(#cam-arrow)" />
    <path class="d-line" d="M220,165 L220,200" marker-end="url(#cam-arrow)" />
    <path class="d-line" d="M220,258 L220,290" marker-end="url(#cam-arrow)" />
    <path class="d-line" d="M220,348 L220,381" marker-end="url(#cam-arrow)" />
    <path class="d-line" d="M345,422 L438,422" marker-end="url(#cam-arrow)" />
    <path class="d-line" d="M220,461 L220,494" marker-end="url(#cam-arrow)" />
    <path class="d-line d-line--accent" d="M220,552 L220,580" marker-end="url(#cam-arrow-accent)" />
  </g>
  <g>
    <rect class="d-box" x="130" y="14" width="180" height="40" rx="20" />
    <text class="d-text" x="220" y="38.2" text-anchor="middle">every 20ms</text>
    <polygon class="d-box" points="220,87 340,126 220,165 100,126" />
    <text class="d-text" x="220" y="130.2" text-anchor="middle">synced and playing?</text>
    <rect class="d-box" x="440" y="98" width="220" height="56" rx="10" />
    <text class="d-text" x="550" y="122.2" text-anchor="middle">cancel any timer</text>
    <text class="d-sub" x="550" y="139.0" text-anchor="middle">nothing to follow</text>
    <rect class="d-box" x="75" y="202" width="290" height="56" rx="10" />
    <text class="d-text" x="220" y="226.2" text-anchor="middle">read the playhead</text>
    <text class="d-sub" x="220" y="243.0" text-anchor="middle">held at a boundary just cut on</text>
    <rect class="d-box" x="75" y="292" width="290" height="56" rx="10" />
    <text class="d-text" x="220" y="316.2" text-anchor="middle">cut to the live camera</text>
    <text class="d-sub" x="220" y="333.0" text-anchor="middle">only if it changed</text>
    <polygon class="d-box" points="220,383 345,422 220,461 95,422" />
    <text class="d-text" x="220" y="426.2" text-anchor="middle">boundary &lt; 40ms away?</text>
    <rect class="d-box" x="440" y="398" width="220" height="48" rx="10" />
    <text class="d-text" x="550" y="426.2" text-anchor="middle">wait for the next tick</text>
    <rect class="d-box" x="75" y="496" width="290" height="56" rx="10" />
    <text class="d-text" x="220" y="520.2" text-anchor="middle">arm a one-shot timer</text>
    <text class="d-sub" x="220" y="537.0" text-anchor="middle">ms left − mixer latency</text>
    <rect class="d-box d-box--accent" x="75" y="582" width="290" height="52" rx="26" />
    <text class="d-text" x="220" y="604.2" text-anchor="middle">timer fires</text>
    <text class="d-sub" x="220" y="621.0" text-anchor="middle">the mixer cuts on the frame</text>
  </g>
  <g>
    <text class="d-sub" x="389" y="119" text-anchor="middle">no</text>
    <text class="d-sub" x="228" y="180" text-anchor="start">yes</text>
    <text class="d-sub" x="391.5" y="415" text-anchor="middle">no</text>
    <text class="d-sub" x="228" y="476" text-anchor="start">yes</text>
  </g>
</svg>
</figure>

The device works from state it already holds: the camera clips from the
bootstrap, and the anchor from `transport:state`. Two loops do the timing.

**A coarse loop, every 20ms,** reads the synced clock, works out the current
frame, makes sure the mixer is on whatever is live at that frame, and finds the
next clip boundary. Because it re-reads the clock every time, a clock
correction, a seek or a clip edit is picked up within one tick.

**A precise one-shot timer** is armed only once the boundary is less than two
ticks away, for exactly the milliseconds that remain. Arming late keeps the
timer's delay short, so a clock correction cannot build up inside it. When it
fires it looks up the clip that starts at the boundary, reads that clip's source
code, and cuts.

Making sure the mixer is on the live camera every tick is what covers everything
that is not a scheduled boundary: joining in the middle of a shot, a play or a
seek, an edit under the playhead, and a boundary the loop slept through because
the process was busy. The mixer is only sent a cut when the camera actually
changes, so on an ordinary tick this does nothing.

One detail keeps the two loops from fighting. The timer fires
`MIXER_LATENCY_MS` early, so for those few milliseconds the playhead is still
short of the boundary, and the coarse loop would see the old clip and cut
straight back. `landed` remembers the boundary the timer cut on, and the loop
reads the timeline at that boundary until the playhead gets there.

A clip's window follows the same rules as the server's:

- It starts at its `position`.
- With an `end`, it lasts `end − mediaStart` frames (`mediaStart` counts as 0
  when it is null).
- Without an `end`, it lasts until the next clip on the track.
- Between clips nothing is active. The mixer stays on the last camera rather
  than cutting to black.

### The code

```js
// cameraCut.js
import { io } from 'socket.io-client';
import { createServerClock } from './serverClock.js';

const BASE         = 'https://cino.no';
const TIMELINE_ID  = process.env.CINO_TIMELINE_ID;
const CAMERA_TRACK = process.env.CINO_CAMERA_TRACK;   // id of the track that scripts the cameras

// Source short code -> mixer input. The codes are set on the production's sources.
const INPUTS = { C1: 1, C2: 2, C3: 3, C4: 4, CRN: 5, STC: 6 };

// How long the mixer takes between receiving a command and the picture changing.
// Measure it once (film a frame counter through the mixer) and put it here; the
// cut is sent that much early.
const MIXER_LATENCY_MS = 0;

const TICK_MS = 20;

const mixer = {
  cut(input) { /* send to your hardware: ATEM, vMix, TSL, GPI... */ },
};

// ── State ────────────────────────────────────────────────────────────────────

const socket = io(`${BASE}/timeline`, {
  path: '/socket',
  transports: ['polling', 'websocket'],
  auth: { token: process.env.CINO_TOKEN },
});
const clock = createServerClock(socket);   // before connect, so the first burst is not missed

let clips     = [];          // the camera track's clips, sorted by position
const codes   = new Map();   // sourceId -> short code
let transport = null;        // the anchor, exactly as it arrived
let onAir     = null;        // the code the mixer is showing
let armed     = null;        // { boundary, timer } — the one-shot timer, when set
let landed    = null;        // the boundary the timer last cut on, until the playhead reaches it

// ── Timeline maths ───────────────────────────────────────────────────────────

const clipEnd = c => (c.end == null ? null : c.position + (c.end - (c.mediaStart ?? 0)));

function activeAt(frame) {
  let active = null;
  for (const c of clips) {
    if (c.position > frame) break;
    active = c;
  }
  if (!active) return null;
  const end = clipEnd(active);
  return end != null && frame >= end ? null : active;
}

function nextBoundary(frame) {
  let next = Infinity;
  for (const c of clips) {
    if (c.position > frame) next = Math.min(next, c.position);
    const end = clipEnd(c);
    if (end != null && end > frame) next = Math.min(next, end);
  }
  return next;
}

function currentFrame() {
  if (!transport || !clock.synced) return null;
  if (!transport.playing) return transport.frame;
  return transport.frame + ((clock.now() - transport.at) / 1000) * transport.frameRate;
}

// ── Cutting ──────────────────────────────────────────────────────────────────

function cutTo(frame) {
  const clip  = activeAt(frame);
  const code  = clip?.sourceId ? codes.get(clip.sourceId) : null;
  const input = code ? INPUTS[code] : undefined;
  if (input === undefined || code === onAir) return;   // a gap, an unmapped source, or no change
  mixer.cut(input);
  onAir = code;
  console.log(`frame ${Math.round(frame)}: cut to ${code} (input ${input})`);
}

function disarm() {
  if (armed) clearTimeout(armed.timer);
  armed = null;
}

setInterval(() => {
  const now = currentFrame();
  if (now == null || !transport.playing) { disarm(); return; }

  // The timer fires MIXER_LATENCY_MS early. Until the playhead really reaches
  // the boundary it cut on, read the timeline AT that boundary — otherwise the
  // next line would see the previous clip and cut straight back.
  if (landed !== null && now >= landed) landed = null;
  const frame = landed ?? now;

  // Whatever is live right now. Does nothing when nothing changed; otherwise it
  // catches joining mid-shot, a seek, an edit, or a boundary the loop slept through.
  cutTo(frame);

  const boundary = nextBoundary(frame);
  if (armed && armed.boundary !== boundary) disarm();   // an edit moved it
  if (boundary === Infinity || armed) return;

  const msUntil = ((boundary - now) / transport.frameRate) * 1000 - MIXER_LATENCY_MS;
  if (msUntil <= TICK_MS * 2) {
    armed = {
      boundary,
      timer: setTimeout(() => { armed = null; landed = boundary; cutTo(boundary); }, Math.max(0, msUntil)),
    };
  }
}, TICK_MS);

// ── Following the room ───────────────────────────────────────────────────────

async function bootstrap() {
  const res = await fetch(`${BASE}/api/timeline/${TIMELINE_ID}`, {
    headers: { Authorization: `Bearer ${process.env.CINO_TOKEN}` },
  });
  if (!res.ok) throw new Error(`bootstrap failed: ${res.status}`);
  const data = await res.json();

  codes.clear();
  for (const s of data.sources) codes.set(s.id, s.shortName);
  const track = data.tracks.find(t => t.id === CAMERA_TRACK);
  clips = [...(track?.clips ?? [])].sort((a, b) => a.position - b.position);
}

socket.on('connect', async () => {
  await bootstrap();
  socket.emit('timeline:join', { timelineId: TIMELINE_ID }, (ack) => {
    if (ack.error) console.error('join refused:', ack.error);
  });
});

socket.on('transport:state', (state) => {
  transport = state;   // never converted: currentFrame() reads it through the clock
  landed = null;       // a play or seek; the old boundary means nothing now
  disarm();
});

// "Sync clocks" in the editor: measure afresh, then report. A Play pressed
// meanwhile waits for this answer, for up to 4 seconds.
socket.on('clock:measure', async ({ requestId }) => {
  await clock.measure();
  if (socket.connected) socket.emit('clock:report', { requestId, rtt: clock.rtt });
});

socket.on('clip:change', (change) => {
  if (change.trackId !== CAMERA_TRACK) return;
  clips = clips.filter(c => c.id !== (change.type === 'upsert' ? change.clip.id : change.clipId));
  if (change.type === 'upsert') clips.push(change.clip);
  clips.sort((a, b) => a.position - b.position);
  disarm();            // the boundary the timer was set for may have moved
});

socket.on('track:change', (change) => {
  if (change.type === 'remove' && change.trackId === CAMERA_TRACK) {
    clips = [];
    disarm();
  }
});
```

### Things this example deliberately does

**It ignores the transport while stopped.** A stopped timeline is browsed
privately in the editor, so a pause leaves the mixer on the camera it was
showing. It does not follow somebody scrubbing around.

**It cuts on catch-up even mid-clip.** Joining a show in the middle of a shot,
or someone seeking, puts the right camera up at once rather than waiting for
the next boundary.

**It re-bootstraps on every reconnect.** Source codes are read from the
bootstrap, so renaming a source's short code reaches the device on its next
connect. Restart the device after changing the codes during a show.

**It never guesses before the clock is synced.** Until the first `time:ping`
answers, `currentFrame()` is null and nothing is cut.

---

## What accuracy to expect

The offset is never worse than half the best round trip in the window. On a
WebSocket with a 40ms round trip that is 20ms, half a frame at 25fps. On a local
network it is a few milliseconds.

Your device adds its own error on top. `setTimeout` in Node.js and in browsers
fires at the earliest after its delay and can be late by a few milliseconds when
the process is busy, so keep a timing device's process free of heavy work.
Hardware adds its latency too, which is what `MIXER_LATENCY_MS` is for. Measure
both, because nobody else can.

Next: [writing changes](./writing.md).
