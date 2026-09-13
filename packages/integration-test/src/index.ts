import { Cino, createClockStatusWatch, type ClipEvent } from 'cino-sdk';
import { resolveConfig, ConfigError } from './config.ts';
import { createCameraWatch } from './cameraWatch.ts';

/**
 * A worked example of a third-party integration, built on cino-sdk: follow a
 * timeline with an API token and print to the terminal the moment it cuts to a
 * different camera — on the frame, not after being told.
 *
 * Everything the protocol asks of a device is the SDK's job (packages/cino-sdk):
 * fetching the timeline on every connect, the server clock, answering clock
 * syncs, keeping tracks and clips current, scheduling each clip change, and
 * stopping on a dead credential. What is left here is what a real device adds
 * on top: what counts as a cut (cameraWatch.ts), and what to do with one —
 * print it, where a real device would switch a mixer.
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

// ── Following the timeline ────────────────────────────────────────────────────

const cino = new Cino({ url: config.baseUrl, token: config.token });
const timeline = cino.connect(config.timelineId);

function describeClock(): string {
  const { offsetMs, errorMs } = timeline.clock;
  const offset = offsetMs ?? 0;
  return `offset ${offset >= 0 ? '+' : '−'}${Math.abs(offset).toFixed(1)}ms, good to ±${(errorMs ?? 0).toFixed(1)}ms`;
}

const frameRate = () => timeline.timeline?.frameRate ?? 25;
const timecode = (frame: number) => timeline.timecode(frame) ?? String(Math.round(frame));

const watch = createCameraWatch({
  trackName:  id => timeline.tracks.get(id)?.name ?? id.slice(0, 8),
  cameraName: (id) => {
    const source = timeline.source(id);
    return source ? source.shortName || source.name : null;
  },
});

timeline.on('ready', ({ timeline: info, canEdit }) => {
  log(green('connected'), bold(info.name),
      dim(`${timeline.tracks.list().length} tracks · ${timeline.clips.list().length} clips · ${timeline.sources.length} cameras · ${info.frameRate}fps`));
  log(green('watching'), dim(canEdit ? '(read/write)' : '(read only)'));
});

timeline.on('token', ({ daysLeft }) => {
  // A device that discovers expiry as a failure discovers it during a show.
  const days = Math.floor(daysLeft);
  if (days <= 7) log(yellow(`token expires in ${days}d — rotate it`));
  else log(dim(`token valid for ${days}d`));
});

// ── The actual job ────────────────────────────────────────────────────────────

timeline.on('clip', (event: ClipEvent) => {
  const cut = watch.observe({
    trackId:  event.track.id,
    clipId:   event.clip?.id ?? null,
    label:    event.clip?.label ?? null,
    sourceId: event.clip?.sourceId ?? null,
    frame:    event.frame,
    at:       event.at,
  });
  if (!cut) return;   // same camera, or a gap — not a cut

  const from = cut.from ? `${dim(cut.from)} ${dim('→')} ` : '';
  console.log(
    `${clockLabel()} ${dim(timecode(cut.frame))}  ${dim(`[${cut.trackName}]`)}  ${from}${cyan(bold(cut.to))}`
    + (cut.label ? `  ${dim(cut.label)}` : ''),
  );
});

timeline.on('transport', (state) => {
  const frame = timeline.currentFrame() ?? state.frame;
  log(state.playing ? green('▶ play') : yellow('⏸ pause'), dim(timecode(frame)));
});

timeline.on('presence', (users) => {
  log(dim(`in the room: ${users.map(u => u.name).join(', ') || 'nobody'}`));
});

// ── Clock ─────────────────────────────────────────────────────────────────────

timeline.on('clock', ({ outcome }) => {
  if (outcome === 'first') log(green('clock synced'), dim(describeClock()));
  else if (outcome === 'jump') log(yellow('clock jumped'), dim(`re-synced — ${describeClock()}`));
});

// "Sync clocks" in the editor: the SDK answers it; this only prints what an
// operator watching a terminal needs to know.
const statusWatch = createClockStatusWatch(frameRate);
const levelColour = { info: cyan, ok: green, warn: yellow } as const;

timeline.on('sync', (status) => {
  for (const line of statusWatch.observe(status)) log(levelColour[line.level](line.text));
});

timeline.on('syncReport', ({ rtt }) => {
  if (rtt === null) log(red('clock reported unsynced'), dim('no ping got through'));
  else log(green('clock reported'), dim(describeClock()));
});

// ── Connection ────────────────────────────────────────────────────────────────

timeline.on('disconnected', ({ reason }) => {
  // Cuts keep coming from the last known state until the connection is back.
  // The gap goes unobserved, so the current camera is news on reconnect.
  watch.reset();
  log(yellow('disconnected:'), reason, dim('(still following the last known state)'));
});

timeline.on('error', ({ error }) => {
  log(yellow('connection error:'), error.message, dim('(retrying)'));
});

timeline.on('authFailed', ({ message }) => {
  // The SDK has already stopped: a dead credential does not fix itself.
  log(red('stopped:'), message);
  log(dim('not retrying — issue a new token in production settings → Integrations'));
  process.exitCode = 1;
});

timeline.on('stall', ({ ms }) => {
  log(yellow('process stalled'), dim(`${ms}ms — cuts due during it were late`));
});

// ── Shutdown ──────────────────────────────────────────────────────────────────

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log(dim('stopping'));
    timeline.close();
    process.exit(0);
  });
}

log(dim(`connecting to ${config.baseUrl}`));
