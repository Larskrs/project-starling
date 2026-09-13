import { io, type Socket } from 'socket.io-client';
import { TIMELINE_NAMESPACE, TimelineEvent } from '@starling/realtime';
import { resolveConfig, ConfigError } from './config.ts';
import { createCameraWatch, formatTimecode, type ActiveClip } from './cameraWatch.ts';

/**
 * A worked example of a third-party integration: authenticate with an API
 * token, follow a timeline, and print to the terminal whenever it cuts to a
 * different camera.
 *
 * This is the shape a real device takes — a lighting desk, a router, a tally
 * light — minus the hardware. It is deliberately built the way the integration
 * guide tells integrators to build: bootstrap over REST, never trust socket
 * events alone, re-bootstrap on every connect, and stop retrying a dead
 * credential.
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

const clock = () => dim(new Date().toLocaleTimeString());
const log   = (...parts: string[]) => console.log(clock(), ...parts);

// ── Timeline state, rebuilt from REST on every connect ────────────────────────

interface Bootstrap {
  timeline: { id: string; name: string; frameRate: string };
  tracks: { id: string; name: string }[];
  sources: { id: string; name: string; shortName: string }[];
}

let frameRate = 25;
const trackNames  = new Map<string, string>();
const cameraNames = new Map<string, string>();

const watch = createCameraWatch({
  trackName:  id => trackNames.get(id) ?? id.slice(0, 8),
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
  trackNames.clear();
  cameraNames.clear();
  for (const track of data.tracks) trackNames.set(track.id, track.name);
  for (const source of data.sources) cameraNames.set(source.id, source.shortName || source.name);

  return data;
}

// ── Socket ────────────────────────────────────────────────────────────────────

const socket: Socket = io(`${config.baseUrl}${TIMELINE_NAMESPACE}`, {
  path: '/socket',
  transports: ['websocket'],
  auth: { token: config.token },
});

socket.on('connect', async () => {
  try {
    // Re-bootstrapped on EVERY connect, not only the first. A reconnect means
    // the gap was unobserved and there is no replay, so refetching is the only
    // complete repair.
    const data = await bootstrap();
    // The watcher's memory describes a timeline we stopped watching, so a cut
    // during the gap would otherwise go unreported.
    watch.reset();

    log(green('connected'), bold(data.timeline.name),
        dim(`${data.tracks.length} tracks · ${cameraNames.size} cameras · ${frameRate}fps`));

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
  log(yellow('disconnected:'), reason);
});

// Sent when access is withdrawn while connected: the token was revoked, expired,
// or its role lost the production.
socket.on('access:revoked', () => {
  log(red('access revoked — the token is no longer valid'));
  socket.disconnect();
  process.exitCode = 1;
});

// ── The actual job ────────────────────────────────────────────────────────────

socket.on(TimelineEvent.clipActive, (event: ActiveClip) => {
  const cut = watch.observe(event);
  if (!cut) return;   // same camera, or a gap — not a cut

  const tc = formatTimecode(cut.frame, frameRate);
  const from = cut.from ? `${dim(cut.from)} ${dim('→')} ` : '';

  console.log(
    `${clock()} ${dim(tc)}  ${dim(`[${cut.trackName}]`)}  ${from}${cyan(bold(cut.to))}`
    + (cut.label ? `  ${dim(cut.label)}` : ''),
  );
});

socket.on(TimelineEvent.transportState, (state: { playing: boolean; frame: number }) => {
  log(state.playing ? green('▶ play') : yellow('⏸ pause'), dim(formatTimecode(state.frame, frameRate)));
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
