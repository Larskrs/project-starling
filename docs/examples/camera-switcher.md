---
public: true
title: Camera switcher
order: 1
---

# Cutting a vision switcher from the camera script

A service that follows the camera track on a timeline and cuts a vision switcher
to the camera each clip calls for, on the frame. After every cut it puts the
next camera on preview, so the director can see what is coming. It drives vMix
over its HTTP API or a Blackmagic ATEM over the network. Any other switcher needs
only its two functions replaced.

> Part of the [examples](./index.md). Set up the project there first.

---

## How the timeline describes a camera

Each clip on the camera track carries a **source**: one of the production's
cameras, with a short code such as `C1`, `C2` or `CRN`. The *Camera* track type
preset creates a set of cameras `C1`…`Cn` along with the track type, which is the
quickest way to get started.

The service maps each short code to a switcher input. A clip with no camera, and
the gap between two clips, leave the switcher where it is rather than cutting to
black.

---

## Setting it up

```sh
npm install atem-connection        # only for an ATEM
```

Add to `.env`:

```sh
CAMERA_TRACK=Cameras               # the track's name, or its id
SWITCHER=vmix                      # or atem
SWITCHER_HOST=10.0.0.20
LEAD_MS=0                          # the switcher's latency; see below
```

- **vMix**: turn on the Web Controller in vMix's settings. The service calls its
  HTTP API on port 8088.
- **ATEM**: use the switcher's IP address, as set in ATEM Setup.

The token needs a role with `VIEW`, and nothing more. A device that only follows
the timeline has no business being able to change it.

Change `INPUTS` at the top of the file to match your switcher's inputs, then run:

```sh
node --env-file=.env switcher.ts
```

```
14:22:05  clock synced, good to ±3.2ms
14:22:05  following Act 1: "Cameras" → vMix at 10.0.0.20
14:22:07  playing at 00:01:10:00
14:22:07  00:01:10:00  caught up to C1
14:22:09  00:01:12:08  cut to C2
```

---

## The code

```ts
// switcher.ts
import { Cino, type ClipEvent } from 'cino-sdk';

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`${name} is not set; add it to .env`);
  return value;
}

/** Camera short code → switcher input. The codes are set on the production's sources. */
const INPUTS: Record<string, number> = { C1: 1, C2: 2, C3: 3, C4: 4, CRN: 5 };

const CAMERA_TRACK = env('CAMERA_TRACK', 'Cameras');

const log = (message: string) => console.log(`${new Date().toLocaleTimeString()}  ${message}`);

// ── Switchers ─────────────────────────────────────────────────────────────────

interface Switcher {
  readonly name: string;
  /** Put an input on programme. */
  cut(input: number): Promise<void>;
  /** Put an input on preview, ready for the next cut. */
  preview(input: number): Promise<void>;
}

function vmix(host: string): Switcher {
  const call = async (query: string) => {
    // A switcher that does not answer must not hold up the cuts behind this one.
    const response = await fetch(`http://${host}:8088/api/?${query}`, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) throw new Error(`vMix answered ${response.status}`);
  };
  return {
    name: `vMix at ${host}`,
    cut: input => call(`Function=CutDirect&Input=${input}`),
    preview: input => call(`Function=PreviewInput&Input=${input}`),
  };
}

async function atem(host: string): Promise<Switcher> {
  const { Atem } = await import('atem-connection');
  const mixer = new Atem();
  mixer.on('error', message => log(`ATEM: ${message}`));
  mixer.on('disconnected', () => log('ATEM disconnected'));

  log(`connecting to the ATEM at ${host}…`);
  const connected = new Promise<void>(resolve => mixer.once('connected', () => resolve()));
  await mixer.connect(host);
  await connected;

  return {
    name: `ATEM at ${host}`,
    cut: input => mixer.changeProgramInput(input),
    preview: input => mixer.changePreviewInput(input),
  };
}

const switcher = env('SWITCHER', 'vmix') === 'atem' ? await atem(env('SWITCHER_HOST')) : vmix(env('SWITCHER_HOST'));

// ── Following the timeline ────────────────────────────────────────────────────

const cino = new Cino({ url: env('CINO_URL', 'https://cino.no'), token: env('CINO_TOKEN') });
const live = cino.connect(env('CINO_TIMELINE'), {
  // Every cut is sent this much early, so the picture changes on the frame.
  leadMs: Number(env('LEAD_MS', '0')),
});

const inputOf = (sourceId: string | null | undefined): number | undefined => {
  const code = live.source(sourceId)?.shortName;
  return code === undefined ? undefined : INPUTS[code];
};

/** The input this service last put on programme. A cut made by hand is left alone. */
let onAir: number | null = null;

async function follow({ track, clip, frame, onBoundary }: ClipEvent): Promise<void> {
  const code = live.source(clip?.sourceId)?.shortName;
  if (!code) return;                          // a gap, or a clip with no camera: stay where we are

  const input = INPUTS[code];
  if (input === undefined) { log(`no switcher input for ${code}; add it to INPUTS`); return; }
  if (input === onAir) return;                // a new clip on the camera already up

  onAir = input;
  try {
    await switcher.cut(input);
    log(`${live.timecode(frame)}  ${onBoundary ? 'cut to' : 'caught up to'} ${code}`);
  } catch (err) {
    onAir = null;                             // so the next change tries again
    log(`cut to ${code} failed: ${(err as Error).message}`);
    return;
  }

  // The next different camera the script calls for goes on preview.
  const next = live.clips.list(track.id)
    .filter(upcoming => upcoming.position > frame)
    .map(upcoming => inputOf(upcoming.sourceId))
    .find(upcoming => upcoming !== undefined && upcoming !== input);
  if (next !== undefined) {
    await switcher.preview(next).catch(err => log(`preview failed: ${(err as Error).message}`));
  }
}

// One command at a time, so two cuts a frame apart reach the switcher in order.
let queue = Promise.resolve();
live.onTrack(CAMERA_TRACK, (event) => {
  queue = queue.then(() => follow(event));
});

// ── What an operator needs to see ─────────────────────────────────────────────

live.on('ready', ({ timeline, reconnected }) => {
  const track = live.tracks.find(CAMERA_TRACK);
  if (!track) log(`${timeline.name} has no track called "${CAMERA_TRACK}"`);
  else log(`${reconnected ? 'reconnected to' : 'following'} ${timeline.name}: "${track.name}" → ${switcher.name}`);
});

live.on('clock', ({ outcome, errorMs }) => {
  if (outcome === 'first') log(`clock synced, good to ±${errorMs.toFixed(1)}ms`);
});

live.on('transport', ({ playing }) => log(`${playing ? 'playing' : 'stopped'} at ${live.timecode()}`));
live.on('disconnected', () => log('connection lost; still cutting from the last known script'));
live.on('stall', ({ ms }) => log(`process stalled ${ms}ms; cuts due during it were late`));

live.on('token', ({ daysLeft }) => {
  if (daysLeft < 7) log(`the token expires in ${Math.floor(daysLeft)} days; issue a new one`);
});

live.on('authFailed', ({ message }) => {
  log(`stopped: ${message}`);
  process.exit(1);
});

process.on('SIGINT', () => {
  live.close();
  process.exit(0);
});
```

---

## Measuring the switcher's latency

A switcher takes a moment between receiving a command and changing the picture,
and with `LEAD_MS=0` every cut lands that much late. To measure it, put a clip on
the camera track at a known timecode and record the programme output with the
editor's timecode in shot. Count the frames between the timecode reaching the
clip and the picture changing, then set:

```
LEAD_MS = frames late × 1000 ÷ frame rate
```

Two frames late at 25 fps is `LEAD_MS=80`. Measure again after changing the
network or the switcher's firmware.

---

## How it behaves

**Joining in the middle of a shot.** The first clip event after connecting is a
catch-up, and the service puts the live camera up at once rather than waiting
for the next cut. The same goes for a seek, and for an edit under the playhead.

**A pause.** Nothing moves. A stopped timeline is browsed privately in the
editor, so the switcher does not follow somebody scrubbing around.

**A cut by hand.** The service only remembers what it sent. If the director cuts
to another camera, the service leaves it there until the script calls for a
different camera than the one the service last put up.

**A cut that fails.** The service logs it and forgets what is on air, so the
next change in the script tries again.

**A dropped connection.** Cuts keep coming from the script as the service last
knew it. When the connection returns, the SDK fetches the timeline again, and
the service only cuts if the live camera differs from the one on air.

**A dead token.** The service stops, says why, and exits with code 1.

---

## Taking it further

**More than one feed.** A second camera track, for an ISO recorder or a second
M/E, is another `live.onTrack` with its own `onAir`. On an ATEM, pass the M/E to
`changeProgramInput(input, me)`.

**Another switcher.** Anything with a network API fits behind `Switcher`. Write
`cut` and `preview` for it and choose it with `SWITCHER`.

**Tally.** Clip events already say which camera is on air and which is next, so
the same listener can light a tally. The [camera display](./camera-display.md)
shows the script as a moving strip across the multiview.
