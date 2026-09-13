/**
 * The live-sync wire contract, shared by the API, the web client and any native
 * client.
 *
 * ── Why this package exists ────────────────────────────────────────────────
 * These event names and payload shapes used to be declared THREE times — once
 * in the server namespace, once in the client composable, once as a table in
 * docs/API.md — with nothing tying them together. Renaming a field meant
 * finding all three, and forgetting one produced a silent desync rather than a
 * build error. Now the server and the client import the same declarations, so a
 * mismatch cannot compile.
 *
 * The package is deliberately types-and-constants only: no socket.io import, no
 * runtime dependencies, nothing environment-specific. It has to be safe for a
 * browser bundle and a Node server to share.
 */

// ── Event names ───────────────────────────────────────────────────────────────
// Constants rather than string literals at the call sites, so a typo is a
// compile error instead of an event nobody ever receives.

export const TIMELINE_NAMESPACE = '/timeline' as const;

export const TimelineEvent = {
  /** C→S. Join a timeline room; acked with the caller's capabilities. */
  join:  'timeline:join',
  /** C→S. Leave without disconnecting. */
  leave: 'timeline:leave',
  /** S→C. The room's current occupants, after any change. */
  presence: 'timeline:presence',
  /** S→C, and C→S on legacy clients. A clip was created, changed or removed. */
  clipChange: 'clip:change',
  /** S→C, and C→S on legacy clients. A track was created, changed, removed or reordered. */
  trackChange: 'track:change',
  /** C→S. Ask the room's transport to play, pause or seek. */
  transportCommand: 'transport:command',
  /** S→C. The room's authoritative transport anchor. */
  transportState: 'transport:state',
  /** C→S. NTP-style clock probe; acked with the server's clock in ms (monotonic, not wall-clock). */
  timePing: 'time:ping',
  /** C→S. Make every client in the room re-measure its clock. Acked with the run's id. */
  clockResync: 'clock:resync',
  /** S→C. Re-measure your clock now, then send `clock:report` within `deadlineMs`. */
  clockMeasure: 'clock:measure',
  /** C→S. The answer to a `clock:measure`. */
  clockReport: 'clock:report',
  /** S→C. A resync's progress, per client. */
  clockStatus: 'clock:status',
} as const;

export type TimelineEventName = (typeof TimelineEvent)[keyof typeof TimelineEvent];

// ── Clock resync ──────────────────────────────────────────────────────────────
// Before a show, an operator presses "Sync clocks": every client in the room
// re-measures its clock against the server and reports how good its estimate
// now is. While that runs, the server holds any Play, so nobody starts the show
// on an estimate still being refined. Rules: apps/api/src/lib/clockResync.ts.

export interface ClockMeasureRequest {
  requestId: string;
  /** Answer within this many ms, or be listed as not answering. */
  deadlineMs: number;
}

export interface ClockReport {
  requestId: string;
  /**
   * Round trip (ms) of the sample the client's estimate rests on — its offset is
   * never wrong by more than half this. Null when no ping answered at all.
   */
  rtt: number | null;
}

/**
 * - `waiting`   asked, has not answered yet
 * - `synced`    answered with a measured estimate
 * - `failed`    answered, but no ping got through
 * - `no-report` the deadline passed first — an older client, or a stuck one
 * - `left`      disconnected or left the room mid-run
 */
export type ClockClientState = 'waiting' | 'synced' | 'failed' | 'no-report' | 'left';

export interface ClockClientStatus {
  socketId: string;
  /** Presence id; a device's carries TOKEN_PRESENCE_PREFIX. */
  id: string;
  name: string;
  state: ClockClientState;
  rtt: number | null;
}

export interface ClockSyncStatus {
  requestId: string;
  state: 'measuring' | 'done';
  requestedBy: { id: string; name: string };
  /** Server clock ms. */
  startedAt: number;
  finishedAt: number | null;
  deadlineMs: number;
  /** A Play is waiting for this run to end, and starts the moment it does. */
  playHeld: boolean;
  /** One entry per socket: two tabs are two clocks. */
  clients: ClockClientStatus[];
}

export type ClockResyncAck = { ok: true; requestId: string } | { error: string };

export function isClockReport(value: unknown): value is ClockReport {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.requestId !== 'string' || !v.requestId) return false;
  return v.rtt === null || (typeof v.rtt === 'number' && Number.isFinite(v.rtt) && v.rtt >= 0);
}

/**
 * Header carrying the sender's socket id on a mutating REST request.
 *
 * The server relays a write to the room the moment it is persisted, which means
 * it has to know who NOT to send it back to. On a socket-initiated relay that
 * is implicit (`socket.to(room)` excludes the sender); over HTTP the request
 * carries no socket identity of its own, so the client supplies it.
 *
 * Omitting it is safe — the originator simply receives its own change back,
 * which is idempotent — so an older client, curl, or a native client that never
 * opened a socket all keep working.
 */
export const SOCKET_ID_HEADER = 'x-socket-id';

// ── Payloads ──────────────────────────────────────────────────────────────────
// Discriminated unions, not bags of optional fields.
//
// The previous shape was `{ type, trackId, clip?, clipId? }`, which let
// `{ type: 'remove', trackId }` — with no clipId — typecheck perfectly and then
// fail at runtime. Splitting per variant makes the invalid states
// unrepresentable, so the compiler catches what a reviewer otherwise has to.

/**
 * A clip row as it travels on the wire.
 *
 * Deliberately loose: the server relays whatever its REST route returned, and
 * the timeline bootstrap enriches clips with joined fields (`fileType`) that no
 * single DB row carries. Pinning this to the Drizzle row type would make the
 * enriched shape a type error at exactly the point it is most useful.
 */
export interface WireClip {
  id: string;
  trackId: string;
  position: number;
  [key: string]: unknown;
}

export interface WireTrack {
  id: string;
  timelineId: string;
  [key: string]: unknown;
}

export type ClipChange =
  | { type: 'upsert'; trackId: string; clip: WireClip }
  | { type: 'remove'; trackId: string; clipId: string };

export type TrackChange =
  | { type: 'upsert'; track: WireTrack }
  | { type: 'remove'; trackId: string }
  | { type: 'reorder'; order: string[] };

export interface PresenceUser {
  id: string;
  name: string;
  avatarImageId: string | null;
  createdAt: string | Date;
}

/**
 * Presence id prefix for a socket authenticated with an API token.
 *
 * Namespaced so a device can never collide with a user id — without it a desk
 * would join under the id of whoever issued its token. Clients use the same
 * prefix to list devices apart from people.
 */
export const TOKEN_PRESENCE_PREFIX = 'token:';

/** Whether a presence entry is an API account (a device) rather than a person. */
export function isDevicePresence(id: string): boolean {
  return id.startsWith(TOKEN_PRESENCE_PREFIX);
}

/**
 * The room's authoritative transport.
 *
 * `frame` is the anchor position at server time `at`; while playing, the
 * position at any server time t is `frame + (t − at)/1000 × frameRate`. Clients
 * never stream positions — they send commands and derive the rest — so a
 * command's network delay cancels out and every client lands on the same frame.
 */
export interface TransportState {
  playing: boolean;
  frame: number;
  frameRate: number;
  userId: string;
  at: number;
}

export type TransportAction = 'play' | 'pause' | 'seek';

export interface TransportCommand {
  action: TransportAction;
  /** Required for play and seek; ignored for pause, which reads the server clock. */
  frame?: number;
}

/** What `timeline:join` acks with, so a client knows its capabilities up front. */
export type JoinAck =
  | { ok: true; canEdit: boolean; canRename: boolean }
  | { error: string };

// ── Guards ────────────────────────────────────────────────────────────────────
// The server must never trust an inbound payload's shape. These live beside the
// types so a change to one is an obvious prompt to update the other.

export function isClipChange(value: unknown): value is ClipChange {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.trackId !== 'string') return false;
  if (v.type === 'upsert') return !!v.clip && typeof v.clip === 'object';
  if (v.type === 'remove') return typeof v.clipId === 'string';
  return false;
}

export function isTrackChange(value: unknown): value is TrackChange {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.type === 'upsert')  return !!v.track && typeof v.track === 'object';
  if (v.type === 'remove')  return typeof v.trackId === 'string';
  if (v.type === 'reorder') return Array.isArray(v.order) && v.order.every(id => typeof id === 'string');
  return false;
}

export function isTransportCommand(value: unknown): value is TransportCommand {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.action !== 'play' && v.action !== 'pause' && v.action !== 'seek') return false;
  if (v.action === 'pause') return true;
  return typeof v.frame === 'number' && Number.isFinite(v.frame);
}
