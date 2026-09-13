import { io, type Socket } from 'socket.io-client';
import {
  TIMELINE_NAMESPACE, TimelineEvent,
  type ClipChange, type TrackChange, type ClockMeasureRequest, type ClockSyncStatus,
} from '@starling/realtime';
import { resolveConfig, ConfigError } from './config.ts';
import { createCameraWatch, formatTimecode } from './cameraWatch.ts';
import { createServerClock, type SampleOutcome } from './serverClock.ts';
import { startClockSync } from './clockSync.ts';
import { answerMeasure, createClockStatusWatch, type MeasurableClock } from './resync.ts';
import { createTimelineModel, type BootstrapTrack } from './timelineModel.ts';
import { createClipScheduler, TICK_MS, type TransportAnchor } from './clipScheduler.ts';

/**
 * A worked example of a third-party integration: authenticate with an API
 * token, follow a timeline, and print to the terminal the moment it cuts to a
 * different camera — on the frame, not after being told.
 *
 * This is the shape a real device takes — a lighting desk, a router, a tally
 * light — minus the hardware. It is deliberately built the way the integration
 * guide tells integrators to build: bootstrap over REST, never trust socket
 * events alone, re-bootstrap on every connect, and stop retrying a dead
 * credential.
 *
 * Timing is its own, because the server does not announce clip changes: it
 * measures the server's clock with `time:ping` (serverClock.ts, clockSync.ts),
 * keeps every track and clip in memory (timelineModel.ts), and works out when
 * each clip boundary arrives (clipScheduler.ts).
 */

const config = (() => {
  try {
    return resolveConfig(process.env, process.argv.slice(2));
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`\n  ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
})();

// ── Terminal output ───────────────────────────────────────────────────────────
// Colour only when stdout is a terminal — piped into a file or a log collector,
// escape codes are noise.
const tty = process.stdout.isTTY;
const c = (code: string, s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim    = (s: string) => c('2', s);
const bold   = (s: string) => c('1', s);
const green  = (s: string) => c('32', s);
const yellow = (s: string) => c('33', s);
const red    = (s: string) => c('31', s);
const cyan   = (s: string) => c('36', s);

// Display only. Nothing is ever timed against the wall clock.
const clockLabel = () => dim(new Date().toLocaleTimeString());
const log = (...parts: string[]) => console.log(clockLabel(), ...parts);

/** A timer that must not keep the process alive by itself — the socket does that. */
const background = (timer: unknown) => (timer as { unref?: () => void }).unref?.();

// ── Timeline state, rebuilt from REST on every connect ────────────────────────

interface Bootstrap {
  timeline: { id: string; name: string; frameRate: string };
  tracks: BootstrapTrack[];
  sources: { id: string; name: string; shortName: string }[];
}

let frameRate = 25;
const model       = createTimelineModel();
const cameraNames = new Map<string, string>();

const watch = createCameraWatch({
  trackName:  id => model.trackName(id) ?? id.slice(0, 8),
  cameraName: id => cameraNames.get(id) ?? null,
});

async function bootstrap(): Promise<Bootstrap> {
  const res = await fetch(`${config.baseUrl}/api/timeline/${config.timelineId}`, {
    headers: { Authorization: `Bearer ${config.token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { errorKey?: string; error?: string };
    throw new Error(body.errorKey ?? body.error ?? `bootstrap failed (${res.status})`);
  }

  // Read the expiry the API attaches to every authenticated response, and warn
  // while there is still time to rotate. A device that discovers this as a 401
  // discovers it during a show.
  const expires = res.headers.get('x-cino-token-expires');
  if (expires) {
    const days = Math.floor((Date.parse(expires) - Date.now()) / 86_400_000);
    if (days <= 7) log(yellow(`token expires in ${days}d — rotate it`));
    else log(dim(`token valid for ${days}d`));
  }

  const data = await res.json() as Bootstrap;

  frameRate = parseFloat(data.timeline.frameRate) || 25;
  model.load(data.tracks);
  cameraNames.clear();
  for (const source of data.sources) cameraNames.set(source.id, source.shortName || source.name);

  return data;
}

// ── Socket ────────────────────────────────────────────────────────────────────

const socket: Socket = io(`${config.baseUrl}${TIMELINE_NAMESPACE}`, {
  path: '/socket',
  // Polling first, upgrading when it can. cino.no sits behind nginx/Passenger,
  // which does not forward the WebSocket upgrade — a websocket-only client
  // never connects there, while polling works everywhere a browser does.
  transports: ['polling', 'websocket'],
  auth: { token: config.token },
});

// ── Server clock ──────────────────────────────────────────────────────────────
// Everything below is timed against the SERVER's clock, estimated from ping
// round trips on our own monotonic clock. Started straight after the socket is
// created, so the first burst goes out with the first connect.

const clock = createServerClock();

function describeClock(): string {
  const offset = clock.offset ?? 0;
  const sign   = offset >= 0 ? '+' : '−';
  return `offset ${sign}${Math.abs(offset).toFixed(1)}ms, good to ±${((clock.rtt ?? 0) / 2).toFixed(1)}ms`;
}

const clockSync = startClockSync(socket, clock, (outcome: SampleOutcome) => {
  if (outcome === 'first') log(green('clock synced'), dim(describeClock()));
  else if (outcome === 'jump') log(yellow('clock jumped'), dim(`re-synced — ${describeClock()}`));
});

// ── Clock sync on request ─────────────────────────────────────────────────────
// Someone pressed "Sync clocks" in the editor. Measure afresh, then report how
// good the estimate is. The room holds any Play until every client has answered
// or the deadline passes — so a device that stays silent is one the operator
// sees listed, rather than one that starts the show on an unchecked clock.
// The rules are in resync.ts.

const measurable: MeasurableClock = {
  measure: () => clockSync.measure(),
  get rtt() { return clock.rtt; },
};

socket.on(TimelineEvent.clockMeasure, async (request: ClockMeasureRequest) => {
  log(cyan('clock sync requested'), dim(`answering within ${request.deadlineMs}ms`));
  const report = await answerMeasure(request, measurable);
  // Dropped mid-burst: the run already counts this socket as gone.
  if (!socket.connected) return;
  socket.emit(TimelineEvent.clockReport, report);
  if (report.rtt === null) log(red('clock reported unsynced'), dim('no ping got through'));
  else log(green('clock reported'), dim(describeClock()));
});

// The run's progress for the whole room: who started it, whether a Play is
// waiting on it, and — when it ends — which clients are not within a frame.
const clockStatusWatch = createClockStatusWatch(() => frameRate);
const levelColour = { info: cyan, ok: green, warn: yellow } as const;

socket.on(TimelineEvent.clockStatus, (status: ClockSyncStatus) => {
  for (const line of clockStatusWatch.observe(status)) log(levelColour[line.level](line.text));
});

// ── The actual job ────────────────────────────────────────────────────────────

const scheduler = createClipScheduler({
  model,
  serverNow: () => clock.now(),
  onActive(event) {
    const cut = watch.observe(event);
    if (!cut) return;   // same camera, or a gap — not a cut

    const tc = formatTimecode(cut.frame, frameRate);
    const from = cut.from ? `${dim(cut.from)} ${dim('→')} ` : '';

    console.log(
      `${clockLabel()} ${dim(tc)}  ${dim(`[${cut.trackName}]`)}  ${from}${cyan(bold(cut.to))}`
      + (cut.label ? `  ${dim(cut.label)}` : ''),
    );
  },
});

background(setInterval(() => scheduler.tick(), TICK_MS));

// If this process itself stalls — heavy output, CPU load, a paused terminal —
// every cut due during it is late. Say so, so it is not read as the clock or the
// server going wrong.
const STALL_CHECK_MS = 1000;
const STALL_MS       = 250;
let lastStallCheck = performance.now();

background(setInterval(() => {
  const now   = performance.now();
  const stall = now - lastStallCheck - STALL_CHECK_MS;
  lastStallCheck = now;
  if (stall > STALL_MS) {
    log(yellow('process stalled'), dim(`${Math.round(stall)}ms — cuts due during it were late`));
  }
}, STALL_CHECK_MS));

socket.on('connect', async () => {
  try {
    // Re-bootstrapped on EVERY connect, not only the first. A reconnect means
    // the gap was unobserved and there is no replay, so refetching is the only
    // complete repair.
    const data = await bootstrap();
    // What was live describes a timeline we stopped watching, so a cut during
    // the gap would otherwise go unreported. If the room is still playing, the
    // join below brings a fresh anchor; if not, there is nothing to follow.
    watch.reset();
    scheduler.reset();

    log(green('connected'), bold(data.timeline.name),
        dim(`${data.tracks.length} tracks · ${model.clipCount} clips · ${cameraNames.size} cameras · ${frameRate}fps`));

    socket.emit(TimelineEvent.join, { timelineId: config.timelineId }, (ack: { error?: string; canEdit?: boolean }) => {
      if (ack?.error) {
        log(red('join refused:'), ack.error);
        socket.disconnect();
        process.exitCode = 1;
        return;
      }
      log(green('watching'), dim(ack.canEdit ? '(read/write)' : '(read only)'));
    });
  } catch (err) {
    log(red('bootstrap failed:'), (err as Error).message);
    socket.disconnect();
    process.exitCode = 1;
  }
});

socket.on('connect_error', (err: Error) => {
  // A credential problem does not fix itself, and a device hammering the
  // handshake is what takes an API instance down on a show night.
  if (err.message.startsWith('errors.auth.')) {
    log(red('authentication failed:'), err.message);
    log(dim('not retrying — issue a new token in production settings → Integrations'));
    socket.disconnect();
    process.exitCode = 1;
    return;
  }
  log(yellow('connection error:'), err.message, dim('(retrying)'));
});

socket.on('disconnect', (reason: string) => {
  // Cuts keep coming through a drop: the anchor does not go stale, the clock
  // keeps its estimate, and every clip is already in memory. A blip mid-show
  // should not stop the show. The reconnect re-bootstraps and replaces it all.
  log(yellow('disconnected:'), reason, dim('(still following the last known state)'));
});

// Sent when access is withdrawn while connected: the token was revoked, expired,
// or its role lost the production.
socket.on('access:revoked', () => {
  log(red('access revoked — the token is no longer valid'));
  scheduler.reset();
  socket.disconnect();
  process.exitCode = 1;
});

socket.on(TimelineEvent.clipChange, (change: ClipChange) => {
  model.applyClipChange(change);
  scheduler.invalidate();
});

socket.on(TimelineEvent.trackChange, (change: TrackChange) => {
  model.applyTrackChange(change);
  scheduler.invalidate();
});

socket.on(TimelineEvent.transportState, (state: TransportAnchor) => {
  // Kept exactly as it arrived; the scheduler reads it through the clock on
  // every tick, so it gets more accurate as the clock estimate does.
  scheduler.setTransport(state);
  const frame = scheduler.currentFrame() ?? state.frame;
  log(state.playing ? green('▶ play') : yellow('⏸ pause'), dim(formatTimecode(frame, frameRate)));
});

socket.on(TimelineEvent.presence, (users: { id: string; name: string }[]) => {
  log(dim(`in the room: ${users.map(u => u.name).join(', ') || 'nobody'}`));
});

// ── Shutdown ──────────────────────────────────────────────────────────────────

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log(dim('stopping'));
    socket.disconnect();
    process.exit(0);
  });
}

log(dim(`connecting to ${config.baseUrl}${TIMELINE_NAMESPACE}`));
