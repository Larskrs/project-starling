// camera-display.ts
import { createServer, type ServerResponse } from 'node:http';
import { Cino, clipEndFrame } from 'cino-sdk';

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`${name} is not set; add it to .env`);
  return value;
}

const PORT = Number(env('DISPLAY_PORT', '8081'));
const CAMERA_TRACK = env('CAMERA_TRACK', 'Cameras');

// const cino = new Cino({ url: env('CINO_URL', 'https://cino.no'), token: env('CINO_TOKEN') });
const cino = new Cino({ url: env('CINO_URL', 'http://localhost:3000'), token: env('CINO_TOKEN') });
const live = cino.connect(env('CINO_TIMELINE'));

// ── What the page is sent ─────────────────────────────────────────────────────

/** Every clip on the camera track that has a camera. Sent whenever it changes. */
function script() {
  const track = live.tracks.find(CAMERA_TRACK);
  const clips = track?.clips ?? [];

  const shots = clips.flatMap((clip, i) => {
    const source = live.source(clip.sourceId);
    if (!source) return [];
    // A clip lasts to its own end, but never past the start of the next clip.
    const own = clipEndFrame(clip);
    const next = clips[i + 1]?.position ?? null;
    const end = own === null ? next : next === null ? own : Math.min(own, next);
    return [{ start: clip.position, end, camera: source.shortName || source.name, hue: source.hue, label: clip.label ?? '' }];
  });

  return {
    timeline: live.timeline?.name ?? null,
    frameRate: live.timeline?.frameRate ?? 25,
    dropFrame: live.timeline?.dropFrame ?? false,
    shots,
  };
}

let problem: string | null = 'connecting…';

/** Where the playhead is now. The page moves it on its own clock in between. */
function playhead() {
  return {
    // Until someone presses play there is no transport, and the script sits at its start.
    frame: live.transport ? live.currentFrame() : live.timeline?.startFrame ?? null,
    playing: live.transport?.playing ?? false,
    problem: problem
      ?? (live.ready && !live.tracks.find(CAMERA_TRACK) ? `no track called "${CAMERA_TRACK}"` : null)
      ?? (live.transport?.playing && !live.clock.synced ? 'measuring the clock…' : null),
  };
}

// ── Keeping every strip current ───────────────────────────────────────────────

const screens = new Set<ServerResponse>();

const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

function send(name: 'script' | 'playhead', data: unknown): void {
  const message = event(name, data);
  for (const screen of screens) screen.write(message);
}

live.on('ready', () => {
  problem = null;
  send('script', script());
  send('playhead', playhead());
});
live.on('change', () => send('script', script()));
live.on('transport', () => send('playhead', playhead()));
live.on('clock', () => send('playhead', playhead()));
live.on('disconnected', ({ reason }) => { problem = `connection lost (${reason})`; send('playhead', playhead()); });
live.on('authFailed', ({ message }) => { problem = `stopped: ${message}`; send('playhead', playhead()); });

// Keeps each page's own clock in step with the room.
setInterval(() => send('playhead', playhead()), 1000);

createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://display');

  if (req.method === 'GET' && pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    res.write(event('script', script()) + event('playhead', playhead()));
    screens.add(res);
    req.on('close', () => screens.delete(res));
    return;
  }

  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE);
    return;
  }

  res.writeHead(404).end();
}).listen(PORT, () => console.log(`camera display on http://localhost:${PORT}`));

// ── The page ──────────────────────────────────────────────────────────────────
// One canvas, redrawn on every screen refresh. It only ever talks to this service.

const PAGE = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Camera timeline</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #0b0b0b; }
  canvas { display: block; width: 100vw; height: 100vh; }
</style>
<canvas id="strip"></canvas>
<script>
  const query = new URLSearchParams(location.search);
  const SECONDS = Number(query.get('seconds')) || 30;
  const PLAYHEAD = Math.min(0.9, Math.max(0.05, Number(query.get('playhead')) || 0.2));
  const CAMERA = query.get('camera');
  const TRANSPARENT = query.has('transparent');
  if (TRANSPARENT) document.documentElement.style.background = document.body.style.background = 'transparent';

  const canvas = document.getElementById('strip');
  const ctx = canvas.getContext('2d');

  let script = { timeline: null, frameRate: 25, dropFrame: false, shots: [] };
  let anchor = null;            // { frame, playing, at }: the playhead, and performance.now() when it arrived
  let problem = 'connecting…';

  // ── Following the service ──────────────────────────────────────────────────

  function frameNow() {
    if (!anchor) return null;
    if (!anchor.playing) return anchor.frame;
    return anchor.frame + ((performance.now() - anchor.at) / 1000) * script.frameRate;
  }

  const events = new EventSource('/events');
  events.addEventListener('script', (message) => { script = JSON.parse(message.data); });
  events.addEventListener('playhead', (message) => {
    const update = JSON.parse(message.data);
    problem = update.problem;
    if (update.frame === null) { anchor = null; return; }
    const predicted = frameNow();
    // Within half a frame of where this page already has it: keep moving smoothly.
    if (anchor && anchor.playing && update.playing && Math.abs(predicted - update.frame) < 0.5) return;
    anchor = { frame: update.frame, playing: update.playing, at: performance.now() };
  });
  events.onerror = () => { problem = 'lost the display service; reconnecting…'; };

  // ── Drawing ────────────────────────────────────────────────────────────────

  const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const pad2 = (n) => String(n).padStart(2, '0');

  function timecode(frame) {
    const nominal = Math.round(script.frameRate);
    let count = Math.max(0, Math.round(frame));
    if (script.dropFrame) {
      const drop = Math.round(nominal / 15);
      const perMinute = nominal * 60 - drop;
      const perTenMinutes = perMinute * 10 + drop;
      const rest = count % perTenMinutes;
      count += drop * 9 * Math.floor(count / perTenMinutes) + (rest > drop ? drop * Math.floor((rest - drop) / perMinute) : 0);
    }
    const seconds = Math.floor(count / nominal);
    return pad2(Math.floor(seconds / 3600)) + ':' + pad2(Math.floor(seconds / 60) % 60) + ':'
      + pad2(seconds % 60) + (script.dropFrame ? ';' : ':') + pad2(count % nominal);
  }

  const countdown = (s) => s < 60 ? Math.ceil(s) + 's' : Math.floor(s / 60) + ':' + pad2(Math.floor(s % 60));

  // Hues are OKLCH, the colour space the editor draws them in, so a camera is the
  // same colour here as on its clips. The editor's clips are oklch(58% 0.2 hue).
  // Converted to plain RGB rather than written as a CSS oklch() string: browsers
  // built into video software can predate oklch(), and a canvas silently ignores
  // a colour it cannot read.
  function oklch(lightness, chroma, hue) {
    const l = lightness / 100;
    const a = chroma * Math.cos((hue * Math.PI) / 180);
    const b = chroma * Math.sin((hue * Math.PI) / 180);
    const long = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const medium = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const short = (l - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    const linear = [
      4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
      -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
      -0.0041960863 * long - 0.7034186147 * medium + 1.7076147010 * short,
    ];
    const channels = linear.map((value) => {
      const v = Math.min(1, Math.max(0, value));   // outside what a screen can show: clip
      return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
    });
    return 'rgb(' + channels.join(', ') + ')';
  }

  function colour(shot, lightness) {
    if (CAMERA && shot.camera !== CAMERA) return oklch(lightness - 20, 0, 0);
    return oklch(lightness, 0.2, shot.hue);
  }

  function fit(text, width) {
    if (ctx.measureText(text).width <= width) return text;
    let cut = text;
    while (cut.length > 1 && ctx.measureText(cut + '…').width > width) cut = cut.slice(0, -1);
    return cut.length > 1 ? cut + '…' : '';
  }

  function panel(x, width, height, title, shot, big, small, lightness) {
    ctx.fillStyle = shot ? colour(shot, lightness) : '#1c1c1c';
    ctx.fillRect(x, 0, width, height);
    const inset = Math.round(height * 0.08);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.font = '700 ' + Math.max(9, Math.round(height * 0.15)) + 'px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(title, x + inset, inset);
    ctx.fillStyle = '#fff';
    ctx.font = '800 ' + Math.round(height * 0.44) + 'px system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(fit(big, width - inset * 2), x + inset, height - inset);
    if (small) {
      ctx.font = '700 ' + Math.round(height * 0.2) + 'px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(small, x + width - inset, inset + height * 0.2);
      ctx.textAlign = 'left';
    }
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!TRANSPARENT) { ctx.fillStyle = '#0b0b0b'; ctx.fillRect(0, 0, W, H); }

    const frame = frameNow();
    const rate = script.frameRate;
    const box = Math.round(Math.min(H * 1.5, W * 0.1));
    const stripX = box * 2 + 6;
    const stripW = Math.max(1, W - stripX);
    const rulerH = Math.round(H * 0.3);
    const laneY = rulerH;
    const laneH = H - rulerH;
    // Over pictures, the ruler needs something behind it to stay readable.
    if (TRANSPARENT) { ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; ctx.fillRect(0, 0, W, rulerH); }
    const pxPerFrame = stripW / (SECONDS * rate);
    const playX = stripX + stripW * PLAYHEAD;
    const xOf = (f) => playX + (f - frame) * pxPerFrame;

    // On air, and next: the same rules as the switcher.
    let onAir = null;
    let next = null;
    if (frame !== null) {
      for (const shot of script.shots) {
        if (shot.start <= frame) onAir = shot;
        else if (!onAir || shot.camera !== onAir.camera) { next = shot; break; }
      }
    }

    // The playhead's timecode box, worked out first so the ruler can leave room for it.
    const playing = anchor !== null && anchor.playing;
    const playText = frame === null ? '' : timecode(frame) + (playing ? '' : '  STOPPED');
    ctx.font = '700 ' + Math.max(10, Math.round(rulerH * 0.55)) + 'px ui-monospace, monospace';
    const playBoxW = ctx.measureText(playText).width + 12;
    const playBoxX = Math.min(Math.max(playX - playBoxW / 2, stripX), W - playBoxW);

    ctx.save();
    ctx.beginPath();
    ctx.rect(stripX, 0, stripW, H);
    ctx.clip();

    if (frame !== null) {
      // The ruler: a tick a second, and a timecode wherever there is room for one.
      ctx.font = '600 ' + Math.max(10, Math.round(rulerH * 0.45)) + 'px ui-monospace, monospace';
      ctx.textBaseline = 'middle';
      const labelWidth = ctx.measureText('00:00:00:00').width + 24;
      const step = STEPS.find((s) => s * rate * pxPerFrame >= labelWidth) || 600;
      const firstSecond = Math.max(0, Math.floor((frame - (playX - stripX) / pxPerFrame) / rate));
      const lastSecond = Math.ceil((frame + (stripX + stripW - playX) / pxPerFrame) / rate);
      const minorTicks = rate * pxPerFrame >= 6;
      ctx.fillStyle = '#8a8a8a';
      for (let s = firstSecond; s <= lastSecond; s++) {
        const major = s % step === 0;
        if (!major && !minorTicks) continue;
        const tick = rulerH * (major ? 0.4 : 0.18);
        ctx.fillRect(Math.round(xOf(s * rate)), rulerH - tick, 1, tick);
        const labelX = xOf(s * rate) + 4;
        const clear = labelX + labelWidth - 24 < playBoxX - 8 || labelX > playBoxX + playBoxW + 8;
        if (major && clear) ctx.fillText(timecode(s * rate), labelX, rulerH * 0.38);
      }

      // The shots.
      const inset = Math.max(2, Math.round(laneH * 0.08));
      for (const shot of script.shots) {
        const x1 = xOf(shot.start);
        const x2 = shot.end === null ? stripX + stripW + 1 : xOf(shot.end);
        if (x2 < stripX || x1 > stripX + stripW) continue;

        const current = shot === onAir && (shot.end === null || shot.end > frame);
        ctx.fillStyle = colour(shot, current ? 66 : 58);
        ctx.fillRect(x1 + 1, laneY + inset, Math.max(1, x2 - x1 - 2), laneH - inset * 2);
        if (current) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.strokeRect(x1 + 2, laneY + inset + 1, x2 - x1 - 4, laneH - inset * 2 - 2);
        }

        // What has already happened is dimmed: the shots only, so pictures under a
        // transparent strip are not darkened where there is nothing to show.
        const past = x2 <= playX;
        if (x1 < playX) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.fillRect(x1 + 1, laneY + inset, Math.min(x2, playX) - x1 - 1, laneH - inset * 2);
        }

        // The name stays readable: just past the playhead while its shot is on it,
        // and at the left edge once the shot has scrolled into the past.
        const onPlayhead = x1 < playX && x2 > playX;
        const textX = (onPlayhead ? playX : Math.max(x1, stripX)) + inset * 2;
        const room = x2 - textX - inset;
        if (room < 12) continue;
        ctx.fillStyle = past ? 'rgba(255, 255, 255, 0.5)' : '#fff';
        ctx.font = '800 ' + Math.round(laneH * 0.42) + 'px system-ui, sans-serif';
        const code = fit(shot.camera, room);
        ctx.fillText(code, textX, laneY + laneH / 2);
        const codeWidth = ctx.measureText(code).width + inset * 2;
        if (shot.label && room - codeWidth > 24) {
          ctx.fillStyle = past ? 'rgba(255, 255, 255, 0.4)' : 'rgba(255, 255, 255, 0.85)';
          ctx.font = '500 ' + Math.round(laneH * 0.26) + 'px system-ui, sans-serif';
          ctx.fillText(fit(shot.label, room - codeWidth), textX + codeWidth, laneY + laneH / 2);
        }
      }

    }
    ctx.restore();

    // The playhead, and the timecode on it.
    if (frame !== null) {
      ctx.fillStyle = playing ? '#ff3b30' : '#9e9e9e';
      ctx.fillRect(Math.round(playX) - 1, 0, 3, H);
      ctx.font = '700 ' + Math.max(10, Math.round(rulerH * 0.55)) + 'px ui-monospace, monospace';
      ctx.textBaseline = 'middle';
      ctx.fillRect(playBoxX, 0, playBoxW, rulerH);
      ctx.fillStyle = '#fff';
      ctx.fillText(playText, playBoxX + 6, rulerH / 2);
    }

    panel(0, box, H, 'ON AIR', onAir, onAir ? onAir.camera : '—', '', 66);
    panel(box + 3, box, H, 'NEXT', next, next ? next.camera : '—', next ? countdown((next.start - frame) / rate) : '', 45);

    if (problem) {
      ctx.font = '600 ' + Math.max(10, Math.round(rulerH * 0.45)) + 'px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      const width = ctx.measureText(problem).width + 16;
      ctx.fillStyle = '#5c1a16';
      ctx.fillRect(W - width, 0, width, rulerH);
      ctx.fillStyle = '#ffb4ab';
      ctx.fillText(problem, W - 8, rulerH / 2);
      ctx.textAlign = 'left';
    }

    requestAnimationFrame(draw);
  }

  requestAnimationFrame(draw);
</script>
</html>`;