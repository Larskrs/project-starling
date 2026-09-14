---
public: true
title: Lighting and sound cues
order: 3
---

# Firing lighting and sound cues over OSC

A service that turns the lighting and sound tracks on a timeline into cues on
the desks that run them. When playback reaches a clip on the `LX` track, an ETC
Eos desk fires that cue. When it reaches a clip on the `SQ` track, QLab starts
that cue. A few seconds before each one, the log calls a standby.

Both desks take **OSC** over UDP, as do most lighting consoles, show controllers
and media servers. The service sends it with nothing but Node.js, so adding
another desk is a few lines.

> Part of the [examples](./index.md). Set up the project there first.

---

## How the timeline describes a cue

- **One track per desk**, named `LX` and `SQ` here. A track type in *event* mode
  suits cues best: each clip lasts until the next one.
- **The cue number is in the clip.** The service reads `data.cue` when a clip has
  one, and otherwise the first number in its label, so `LX 12.5` fires cue
  `12.5`. A clip without a number is shown in the log and never fired.

Put the cue number in `data.cue` when the label should stay readable, such as
`Blackout, top of act 2`.

---

## Setting it up

On the desks:

- **ETC Eos**: turn on OSC receive in the desk's show control settings, and set a
  UDP receive port. The service assumes port 8000 and cue list 1.
- **QLab**: allow OSC control in the workspace's network settings. QLab listens on
  UDP port 53000.

Add to `.env`:

```sh
EOS_HOST=10.0.0.30
EOS_PORT=8000
QLAB_HOST=10.0.0.31
STANDBY_SECONDS=5
LEAD_MS=0
```

The token needs a role with `VIEW`. Run it with:

```sh
node --env-file=.env cues.ts
```

```
19:30:01  LX: 48 cues → 10.0.0.30:8000
19:30:01  SQ: 22 cues → 10.0.0.31:53000, 1 without a cue number
19:31:10  standby LX 12
19:31:15  00:04:12:00  LX GO 12
19:31:15  00:04:12:00  SQ GO 7
```

---

## The code

```ts
// cues.ts
import { createSocket } from 'node:dgram';
import { Cino, type Clip } from 'cino-sdk';

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`${name} is not set; add it to .env`);
  return value;
}

const log = (message: string) => console.log(`${new Date().toLocaleTimeString()}  ${message}`);

// ── Where cues go ─────────────────────────────────────────────────────────────

interface Target {
  /** The timeline track holding this desk's cues, by name or id. */
  track: string;
  host: string;
  port: number;
  /** The OSC address that fires a cue. */
  address: (cue: string) => string;
  /** Also fire the live cue after a join or a seek, not only when playback reaches it. */
  chase: boolean;
}

const TARGETS: Target[] = [
  {
    track: 'LX',
    host: env('EOS_HOST', '127.0.0.1'),
    port: Number(env('EOS_PORT', '8000')),
    address: cue => `/eos/cue/1/${cue}/fire`,
    // Firing a lighting cue brings up its look, which is what a seek needs.
    chase: true,
  },
  {
    track: 'SQ',
    host: env('QLAB_HOST', '127.0.0.1'),
    port: 53000,
    address: cue => `/cue/${cue}/start`,
    // A sound started after a seek plays from its beginning, which is never right.
    chase: false,
  },
];

/** Seconds of warning before each cue. 0 turns standbys off. */
const STANDBY_SECONDS = Number(env('STANDBY_SECONDS', '5'));

// ── OSC ───────────────────────────────────────────────────────────────────────
// A message with no arguments is two OSC strings: the address and an empty type
// tag. Each string ends with a zero byte and is padded to a multiple of four.

function oscString(text: string): Buffer {
  const bytes = Buffer.from(`${text}\0`, 'utf8');
  return Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)]);
}

const udp = createSocket('udp4');

function fire(target: Target, cue: string): void {
  const message = Buffer.concat([oscString(target.address(cue)), oscString(',')]);
  udp.send(message, target.port, target.host, (err) => {
    if (err) log(`${target.track} ${cue} did not send: ${err.message}`);
  });
}

// ── Following the timeline ────────────────────────────────────────────────────

/** The cue a clip fires: `data.cue` when set, else the first number in its label. */
function cueOf(clip: Clip): string | null {
  const cue = (clip.row.data as { cue?: unknown } | null | undefined)?.cue;
  if (typeof cue === 'string' || typeof cue === 'number') return String(cue);
  return clip.label?.match(/\d+(?:\.\d+)?/)?.[0] ?? null;
}

const cino = new Cino({ url: env('CINO_URL', 'https://cino.no'), token: env('CINO_TOKEN') });
const live = cino.connect(env('CINO_TIMELINE'), { leadMs: Number(env('LEAD_MS', '0')) });

for (const target of TARGETS) {
  live.onTrack(target.track, ({ clip, frame, onBoundary }) => {
    const cue = clip && cueOf(clip);
    if (!cue) return;                         // the track went quiet, or the clip has no number

    const at = live.timecode(frame);
    if (onBoundary || target.chase) {
      fire(target, cue);
      log(`${at}  ${target.track} ${onBoundary ? 'GO' : 'chase to'} ${cue}`);
    } else {
      log(`${at}  ${target.track} ${cue} is live; not fired on a catch-up`);
    }
  });

  if (STANDBY_SECONDS > 0) {
    // Worked out again on every tick, so an edit or a seek moves the standby too.
    let upcoming: Clip | null = null;
    live.cue(() => {
      const track = live.tracks.find(target.track);
      const frame = live.currentFrame();
      if (!track || frame === null || !live.timeline) return null;
      upcoming = track.clips.find(clip => clip.position > frame && cueOf(clip) !== null) ?? null;
      return upcoming ? upcoming.position - STANDBY_SECONDS * live.timeline.frameRate : null;
    }, () => {
      if (upcoming) log(`standby ${target.track} ${cueOf(upcoming)}`);
    });
  }
}

// ── What an operator needs to see ─────────────────────────────────────────────

live.on('ready', ({ timeline }) => {
  for (const target of TARGETS) {
    const track = live.tracks.find(target.track);
    if (!track) { log(`${timeline.name} has no track called "${target.track}"`); continue; }
    const unnumbered = track.clips.filter(clip => cueOf(clip) === null).length;
    log(`${target.track}: ${track.clips.length} cues → ${target.host}:${target.port}`
      + (unnumbered ? `, ${unnumbered} without a cue number` : ''));
  }
});

live.on('disconnected', () => log('connection lost; still firing from the last known cues'));
live.on('stall', ({ ms }) => log(`process stalled ${ms}ms; cues due during it were late`));

live.on('authFailed', ({ message }) => {
  log(`stopped: ${message}`);
  process.exit(1);
});

process.on('SIGINT', () => {
  live.close();
  udp.close();
  process.exit(0);
});
```

---

## Why lighting chases and sound does not

Clip events that come from reaching a boundary have `onBoundary: true`. The
others are catch-ups: the service joined a show already playing, someone seeked,
or an edit changed what is under the playhead.

A lighting cue describes a look, and firing it brings that look up however the
stage got there. After a seek into the middle of a scene, firing the live cue is
exactly right, so `LX` chases.

A sound cue is an event. Starting it after a seek plays it from its beginning, in
the wrong place, so `SQ` only fires when playback reaches it. Set `chase` for
each desk you add by asking the same question.

---

## Standby calls

`live.cue` takes a function that works out the frame on every tick. This one
finds the next numbered clip on the track and aims a few seconds before it. Once
playback passes that clip, the function finds the next, and the cue arms again.

A cue closer to the previous one than `STANDBY_SECONDS` gets no standby of its
own, because the moment for it has already passed when the service learns of it.

---

## Timing

Both desks act within a few milliseconds of a message arriving, so `LEAD_MS=0`
is usually right. If a desk runs a long way off across a network, or the fades
start late on video, measure it as the
[switcher example](./camera-switcher.md#measuring-the-switchers-latency) does.

---

## Testing without a desk

Point `EOS_HOST` at `127.0.0.1` and run this beside the service. It prints every
OSC address that arrives on port 8000:

```ts
// listen.ts
import { createSocket } from 'node:dgram';

const socket = createSocket('udp4');
socket.on('message', (message, from) => {
  console.log(`${from.address}  ${message.toString('utf8').split('\0')[0]}`);
});
socket.bind(8000, () => console.log('listening for OSC on port 8000'));
```

```
127.0.0.1  /eos/cue/1/12/fire
```
