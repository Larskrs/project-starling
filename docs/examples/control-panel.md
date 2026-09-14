---
public: true
title: Control panel
order: 2
---

# A control panel for the stage manager

A small service that gives a stage manager a panel for the show: a large
timecode, what is live on every track, who and what is in the room, and buttons
to play, pause, jump, drop a note on the timeline and sync clocks. It opens in
any browser on the network, such as a tablet at the prompt desk, and the same
buttons answer plain HTTP requests, so a Stream Deck can drive them too.

> Part of the [examples](./index.md). Set up the project there first.

---

## Why a service, and not a web page

The panel is a web page, but the page never sees the token. A token inside a
page's JavaScript belongs to anyone who opens it. So the service holds the token
and the connection to Cino, and the page only talks to the service on the local
network.

That shape also means one connection to Cino, however many screens are open,
and a panel that keeps working when a tablet sleeps and wakes.

---

## Setting it up

In the editor, add a track called `Notes` to the timeline. The **Note** button
puts a clip on it at the playhead, which is a quick way to mark a moment in
rehearsal and come back to it.

Add to `.env`:

```sh
PANEL_PORT=8080
PANEL_KEY=a-long-random-string     # every request must carry it
NOTES_TRACK=Notes
```

The token's role needs `EDIT_TIMELINE` for notes. Play, pause, jumping and Sync
clocks need nothing beyond access to the timeline, so a panel without notes
works with `VIEW`.

```sh
node --env-file=.env panel.ts
```

Open `http://<panel machine>:8080/?key=a-long-random-string` on the tablet.

---

## The code

```ts
// panel.ts
import { createServer, type ServerResponse } from 'node:http';
import { Cino, CinoApiError, TOKEN_PRESENCE_PREFIX, type ClockSyncStatus, type PresenceUser } from 'cino-sdk';

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`${name} is not set; add it to .env`);
  return value;
}

const PORT = Number(env('PANEL_PORT', '8080'));
/** When set, every request must carry it, as `?key=` or an `x-panel-key` header. */
const PANEL_KEY = env('PANEL_KEY', '');
const NOTES_TRACK = env('NOTES_TRACK', 'Notes');

const cino = new Cino({ url: env('CINO_URL', 'https://cino.no'), token: env('CINO_TOKEN') });
const live = cino.connect(env('CINO_TIMELINE'));

// ── What the panel shows ──────────────────────────────────────────────────────

let people: readonly PresenceUser[] = [];
let clockRun: ClockSyncStatus | null = null;
let problem: string | null = 'connecting…';
let tokenDays: number | null = null;

function status() {
  const { synced, errorMs } = live.clock;
  return {
    timeline: live.timeline?.name ?? null,
    problem,
    playing: live.transport?.playing ?? false,
    timecode: live.timecode(),
    clock: synced ? `±${Math.max(1, Math.round(errorMs ?? 0))} ms` : 'not measured',
    syncing: clockRun?.state === 'measuring',
    tokenDays,
    nowPlaying: live.clips.nowPlaying().map(({ track, clip }) => ({ track: track.name, clip: clip.label ?? '' })),
    devices: people.filter(user => user.id.startsWith(TOKEN_PRESENCE_PREFIX)).map(user => user.name),
    people: people.filter(user => !user.id.startsWith(TOKEN_PRESENCE_PREFIX)).map(user => user.name),
  };
}

/** Every open panel, sent a fresh status whenever something changes. */
const screens = new Set<ServerResponse>();

function push(): void {
  const event = `data: ${JSON.stringify(status())}\n\n`;
  for (const screen of screens) screen.write(event);
}

live.on('ready', () => { problem = null; push(); });
live.on('disconnected', ({ reason }) => { problem = `connection lost (${reason})`; push(); });
live.on('authFailed', ({ message }) => { problem = `stopped: ${message}`; push(); });
live.on('presence', (users) => { people = users; push(); });
live.on('sync', (run) => { clockRun = run; push(); });
live.on('token', ({ daysLeft }) => { tokenDays = Math.floor(daysLeft); });
live.on('transport', push);
live.on('change', push);
live.on('clip', push);

// While playing, the timecode moves by itself.
setInterval(() => { if (live.transport?.playing) push(); }, 100);

// ── What the panel does ───────────────────────────────────────────────────────

/** Resolves to null when the action worked, or to what went wrong. */
type Action = (params: URLSearchParams) => string | null | Promise<string | null>;

const NOT_CONNECTED = 'not connected to Cino';

/** A frame number, or a timecode such as 00:10:00:00. */
const position = (text: string) => (/^\d+$/.test(text) ? Number(text) : text);

const actions: Record<string, Action> = {
  play: (params) => {
    const from = params.get('from');
    return live.play(from ? position(from) : undefined) ? null : NOT_CONNECTED;
  },

  pause: () => (live.pause() ? null : NOT_CONNECTED),

  nudge: (params) => {
    const frame = live.currentFrame();
    const timeline = live.timeline;
    if (!live.transport?.playing || frame === null || !timeline) return 'jumping only works while the timeline plays';
    const target = frame + Number(params.get('seconds') ?? 0) * timeline.frameRate;
    return live.seek(Math.round(Math.max(timeline.startFrame, target))) ? null : NOT_CONNECTED;
  },

  sync: async () => {
    const ack = await live.syncClocks();
    return 'error' in ack ? ack.error : null;
  },

  note: async (params) => {
    const track = live.tracks.find(NOTES_TRACK);
    const frame = live.currentFrame();
    if (!track) return `this timeline has no track called "${NOTES_TRACK}"`;
    if (frame === null) return NOT_CONNECTED;
    const label = params.get('label') || `Note at ${live.timecode(frame)}`;
    await live.clips.create({ trackId: track.id, position: Math.round(frame), label });
    return null;
  },
};

// ── The server ────────────────────────────────────────────────────────────────

function reply(res: ServerResponse, status: number, body: { ok: boolean; error?: string }): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://panel');

  if (PANEL_KEY && url.searchParams.get('key') !== PANEL_KEY && req.headers['x-panel-key'] !== PANEL_KEY) {
    reply(res, 401, { ok: false, error: 'wrong or missing key' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    res.write(`data: ${JSON.stringify(status())}\n\n`);
    screens.add(res);
    req.on('close', () => screens.delete(res));
    return;
  }

  const name = url.pathname.slice(1);
  const action = req.method === 'POST' && Object.hasOwn(actions, name) ? actions[name] : undefined;
  if (!action) {
    reply(res, 404, { ok: false, error: `no such action: ${req.method} ${url.pathname}` });
    return;
  }

  try {
    const error = await action(url.searchParams);
    reply(res, error ? 409 : 200, error ? { ok: false, error } : { ok: true });
  } catch (err) {
    const error = err instanceof CinoApiError && err.missingPermission
      ? `the token's role needs ${err.missingPermission}`
      : (err as Error).message;
    reply(res, 500, { ok: false, error });
  }
}).listen(PORT, () => console.log(`control panel on http://localhost:${PORT}`));

// ── The page ──────────────────────────────────────────────────────────────────
// Plain HTML with no build step. It only ever talks to this service.

const PAGE = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cino control panel</title>
<style>
  body { margin: 0; padding: 16px; font: 16px/1.4 system-ui, sans-serif; background: #111; color: #eee; }
  h1 { margin: 0; font-size: 20px; font-weight: 600; }
  #timecode { font: 700 clamp(48px, 14vw, 128px)/1 ui-monospace, monospace; margin: 12px 0 8px; }
  #state { color: #aaa; min-height: 1.4em; }
  #state.problem, #flash { color: #ff8a80; }
  .controls { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
  button, input { font: inherit; padding: 14px 18px; border: 0; border-radius: 8px; background: #2a2a2a; color: inherit; }
  input { width: 9em; font-family: ui-monospace, monospace; }
  .play { background: #2e7d32; }
  .pause { background: #b3261e; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 8px; border-top: 1px solid #2a2a2a; }
  td:first-child { color: #aaa; width: 35%; }
</style>
<h1 id="timeline">Connecting…</h1>
<div id="timecode">--:--:--:--</div>
<div id="state"></div>
<div class="controls">
  <button class="play" data-action="play">Play</button>
  <button class="pause" data-action="pause">Pause</button>
  <button data-action="nudge" data-seconds="-10">−10 s</button>
  <button data-action="nudge" data-seconds="10">+10 s</button>
  <input id="from" placeholder="00:00:00:00" aria-label="Play from timecode">
  <button data-action="play" data-from>Play from</button>
  <button data-action="note">Note</button>
  <button data-action="sync">Sync clocks</button>
</div>
<div id="flash" role="status"></div>
<table id="details"></table>
<script>
  const key = new URLSearchParams(location.search).get('key');
  const $ = (id) => document.getElementById(id);

  function url(path, params) {
    const target = new URL(path, location.href);
    for (const [name, value] of Object.entries(params || {})) target.searchParams.set(name, value);
    if (key) target.searchParams.set('key', key);
    return target;
  }

  function row(label, value) {
    const tr = document.createElement('tr');
    tr.insertCell().textContent = label;
    tr.insertCell().textContent = value;
    return tr;
  }

  for (const button of document.querySelectorAll('button')) {
    button.addEventListener('click', async () => {
      const params = {};
      if (button.dataset.seconds) params.seconds = button.dataset.seconds;
      if ('from' in button.dataset) params.from = $('from').value.trim();
      const response = await fetch(url('/' + button.dataset.action, params), { method: 'POST' });
      const body = await response.json();
      $('flash').textContent = body.ok ? '' : body.error;
    });
  }

  new EventSource(url('/events')).onmessage = (message) => {
    const s = JSON.parse(message.data);
    $('timeline').textContent = s.timeline || 'Connecting…';
    $('timecode').textContent = s.timecode || '--:--:--:--';
    $('state').className = s.problem ? 'problem' : '';
    $('state').textContent = s.problem || [
      s.playing ? 'Playing' : 'Stopped',
      'clock ' + s.clock,
      s.syncing ? 'syncing clocks' : '',
      s.tokenDays !== null && s.tokenDays < 7 ? 'token expires in ' + s.tokenDays + ' days' : '',
    ].filter(Boolean).join(' · ');
    $('details').replaceChildren(
      ...s.nowPlaying.map((item) => row(item.track, item.clip)),
      row('Devices', s.devices.join(', ') || 'none'),
      row('People', s.people.join(', ') || 'none'),
    );
  };
</script>
</html>`;
```

---

## Buttons on a Stream Deck

Every button on the page is an HTTP `POST` to the service, so anything that can
send one can press it. Bitfocus Companion, which drives Stream Decks and most
show control surfaces, does it with its generic HTTP module.

| Button | Request |
| --- | --- |
| Play | `POST /play` |
| Play from a timecode | `POST /play?from=00:10:00:00` |
| Pause | `POST /pause` |
| Jump back or forward | `POST /nudge?seconds=-10` |
| Drop a note | `POST /note?label=Lighting%20late` |
| Sync clocks | `POST /sync` |

Send the key as `?key=…` or as an `x-panel-key` header. Every request answers
`{ "ok": true }`, or `{ "ok": false, "error": "…" }` saying why not.

```sh
curl -X POST -H "x-panel-key: $PANEL_KEY" "http://panel.local:8080/play?from=00:10:00:00"
```

---

## How it behaves

**Play and Pause move the whole room.** Every editor and every device follows,
and Pause stops them all on the same frame, worked out by the server.

**Jumping only works while playing.** A stopped timeline is browsed privately by
each person in the editor, so there is no shared playhead to move. To start
somewhere else, use *Play from*.

**Sync clocks holds Play.** A Play pressed during a sync starts the moment every
client has answered, for up to 4 seconds. The panel shows *syncing clocks*
meanwhile.

**The panel is in the room.** It appears under the token's label in the editor's
presence list and among the panel's own *Devices*, which is a quick check that
every device is connected before the show.

**A problem stays on screen.** A lost connection or a dead token replaces the
status line with what went wrong, and the page keeps showing it until it is
fixed.

---

## Keeping it safe

- Run it on the show network only, and never forward its port to the internet.
  If it has to leave the building, put it behind a reverse proxy with HTTPS and a
  proper login.
- Always set `PANEL_KEY`. Without it, anyone on the network can stop the show.
- The token stays in the service's `.env`. The page, the tablet and the Stream
  Deck never see it.

---

## Taking it further

**A countdown.** `live.clips.list(trackId)` gives the next clip on any track, and
the status can carry the time until it: "Interval in 4:32".

**A green room display.** Drop the actions and the key, give the token `VIEW`,
and show only the timecode and what is live.

**GPIO buttons.** Wire physical buttons on a Raspberry Pi to the same actions,
and the stage manager gets a panel that works without looking.
