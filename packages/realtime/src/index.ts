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
 * ── Why the wire is terse ──────────────────────────────────────────────────
 * Protocol 1 spent most of its bytes, and many of its messages, on things no
 * receiver read: event names like `transport:state` on every packet, key names
 * repeated in every anchor, timestamps and nulls in every relayed row, the full
 * client table re-sent on every clock report, the full presence list re-sent on
 * every join. A room of devices on long-polling pays for each message as a
 * request or a response, and the moment every device connects at once — a show
 * starting, the API restarting — is exactly when a throttling proxy notices.
 *
 * So in protocol 2 event names are a letter or two, fixed-shape payloads are
 * positional arrays, rows leave out what the receiver can fill back in, and the
 * chattiest broadcasts are coalesced on the server. Application code never sees
 * any of that: the encoders below are the only place the server builds a
 * payload, and the decoders the only place a client reads one, so the readable
 * types are still the ones everyone programs against.
 *
 * The package is deliberately dependency-free: no socket.io import, nothing
 * environment-specific. It has to be safe for a browser bundle and a Node
 * server to share.
 */

// ── Protocol version ──────────────────────────────────────────────────────────

/**
 * The wire protocol this build speaks. Bumped on any change an older client
 * would misread.
 *
 * A client sends its number in the handshake, `auth: { protocol }`. The server
 * refuses any other number before it spends a token lookup on the socket: the
 * connect_error message is PROTOCOL_ERROR and `data.protocol` is the server's
 * own number, so a client can say which side is out of date rather than fail
 * to understand every event that follows. A successful join repeats the number
 * in its ack. Protocol 1 was the unversioned original, and sent none.
 */
export const PROTOCOL = 2;

/** The connect_error message for a handshake refused for its protocol. */
export const PROTOCOL_ERROR = 'errors.protocol.unsupported';

/** `data` on that connect_error. */
export interface ProtocolErrorData {
  protocol: number;
}

export function isProtocolError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { message?: unknown }).message === PROTOCOL_ERROR;
}

/** The protocol the server named when it refused a handshake; null if it did not say. */
export function serverProtocolOf(err: unknown): number | null {
  const protocol = (err as { data?: { protocol?: unknown } } | null)?.data?.protocol;
  return typeof protocol === 'number' ? protocol : null;
}

// ── Event names ───────────────────────────────────────────────────────────────
// Constants rather than string literals at the call sites, so a typo is a
// compile error instead of an event nobody ever receives. The values are the
// wire; the keys are what code reads.

export const TIMELINE_NAMESPACE = '/timeline' as const;

export const TimelineEvent = {
  /** C→S `timelineId`, acked with a JoinAck: capabilities, occupants, and the room's live state. */
  join: 'j',
  /** C→S, no payload. Leave without disconnecting. */
  leave: 'l',
  /** S→C `PresenceWire[]`. The room's occupants, once a change settles. */
  presence: 'u',
  /** S→C clip row. A clip was created. */
  clipAdd: 'ca',
  /** S→C `{ id, ...changed fields }`. A clip was changed. */
  clipUpdate: 'cu',
  /** S→C clip id. A clip was removed. */
  clipRemove: 'cd',
  /** S→C track row. A track was created. */
  trackAdd: 'ta',
  /** S→C `{ id, ...changed fields }`. A track was changed. */
  trackUpdate: 'tu',
  /** S→C track id. A track and its clips were removed. */
  trackRemove: 'td',
  /** S→C track ids; a track's index is its sortOrder. */
  trackOrder: 'to',
  /** C→S `TransportCommandWire`. Ask the room's transport to play, pause or seek. */
  transportCommand: 'x',
  /** S→C `AnchorWire`. The room's authoritative transport anchor. */
  transportState: 'a',
  /** C→S, no payload. NTP-style clock probe; acked with the server's clock in ms (monotonic, not wall-clock). */
  timePing: 'p',
  /** C→S, no payload. Make every client in the room re-measure its clock; acked with a ClockResyncAck. */
  clockResync: 'r',
  /** S→C `MeasureWire`. Re-measure your clock now, then report within the deadline. */
  clockMeasure: 'm',
  /** C→S `ReportWire`. The answer to a measure request. */
  clockReport: 'e',
  /** S→C `StatusWire`. A resync, whole: sent as it starts. */
  clockStatus: 's',
  /** S→C `ProgressWire`. What changed in the resync since the room last heard. */
  clockProgress: 'sp',
} as const;

export type TimelineEventName = (typeof TimelineEvent)[keyof typeof TimelineEvent];

/**
 * Header carrying the sender's socket id on a mutating REST request.
 *
 * The server relays a write to the room the moment it is persisted, which means
 * it has to know who NOT to send it back to. Over HTTP the request carries no
 * socket identity of its own, so the client supplies it.
 *
 * Omitting it is safe — the originator simply receives its own change back,
 * which is idempotent — so curl, or a client that never opened a socket, keeps
 * working.
 */
export const SOCKET_ID_HEADER = 'x-socket-id';

// ── Shared guards ─────────────────────────────────────────────────────────────
// The server must never trust an inbound payload's shape, and a client should
// not trust one either: a malformed message is dropped, never half-applied.

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isId     = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isFlag   = (v: unknown): v is 0 | 1 => v === 0 || v === 1;

// ── Clips and tracks ──────────────────────────────────────────────────────────
// Discriminated unions, not bags of optional fields, so invalid states are
// unrepresentable.
//
// On the wire each variant is its own event, which is shorter than a `type`
// field and leaves a native client nothing to switch on. A created row is sent
// without its null columns — the decoder puts them back — and a changed row is
// sent as only the fields that changed, nulls included, because a null there is
// the change.

/**
 * A clip row as it travels on the wire.
 *
 * Deliberately loose: the timeline bootstrap enriches clips with joined fields
 * (`fileType`) that no single DB row carries. Pinning this to the Drizzle row
 * type would make the enriched shape a type error at exactly the point it is
 * most useful.
 */
export interface WireClip {
  id: string;
  trackId: string;
  position: number;
  [key: string]: unknown;
}

export interface WireTrack {
  id: string;
  [key: string]: unknown;
}

/** The fields a write changed, and the id of the row they belong to. */
export interface RowPatch {
  id: string;
  [key: string]: unknown;
}

export type ClipChange =
  /** A whole clip. New to the receiver, unless it is the sender's own echo. */
  | { type: 'upsert'; clip: WireClip }
  /** Merge into the clip with this id. A receiver that does not hold it ignores it. */
  | { type: 'patch'; clip: RowPatch }
  | { type: 'remove'; clipId: string };

export type TrackChange =
  | { type: 'upsert'; track: WireTrack }
  | { type: 'patch'; track: RowPatch }
  | { type: 'remove'; trackId: string }
  | { type: 'reorder'; order: string[] };

/** Nullable columns a created row leaves out when null. */
const CLIP_NULLABLE  = ['fileId', 'mediaStart', 'end', 'sourceId', 'hue', 'data'] as const;
const TRACK_NULLABLE = ['sourceId', 'icon'] as const;

/**
 * Columns no client reads from a relay; the bootstrap still carries them. A
 * track keeps its timestamps and timelineId: the editor orders tracks by
 * createdAt, its dialogs build URLs from timelineId, and tracks change rarely
 * enough that neither is worth a special case.
 */
const CLIP_UNSENT: ReadonlySet<string>  = new Set(['createdAt', 'updatedAt']);
const TRACK_UNSENT: ReadonlySet<string> = new Set();

function compactRow(row: object, unsent: ReadonlySet<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined || unsent.has(key)) continue;
    out[key] = value;
  }
  return out;
}

function restoreNulls<T extends object>(row: T, nullable: readonly string[]): T {
  const out = { ...row } as Record<string, unknown>;
  for (const key of nullable) if (!(key in out)) out[key] = null;
  return out as T;
}

/** A created clip, for `clipAdd`. */
export const encodeClip = (row: object): Record<string, unknown> => compactRow(row, CLIP_UNSENT);

/** A created track, for `trackAdd`. */
export const encodeTrack = (row: object): Record<string, unknown> => compactRow(row, TRACK_UNSENT);

/**
 * A changed row, for `clipUpdate` and `trackUpdate`: the fields a write touched,
 * read back from the stored row so they are what the database now holds.
 */
export function encodePatch(row: { id: string }, fields: readonly string[]): RowPatch {
  const source = row as unknown as Record<string, unknown>;
  const out: RowPatch = { id: row.id };
  for (const field of fields) {
    if (field !== 'id' && field in source) out[field] = source[field];
  }
  return out;
}

export function decodeClipAdd(raw: unknown): ClipChange | null {
  if (!isRecord(raw) || !isId(raw.id) || !isId(raw.trackId) || !isNumber(raw.position)) return null;
  return { type: 'upsert', clip: restoreNulls(raw as WireClip, CLIP_NULLABLE) };
}

export function decodeClipUpdate(raw: unknown): ClipChange | null {
  return isRecord(raw) && isId(raw.id) ? { type: 'patch', clip: raw as RowPatch } : null;
}

export function decodeClipRemove(raw: unknown): ClipChange | null {
  return isId(raw) ? { type: 'remove', clipId: raw } : null;
}

export function decodeTrackAdd(raw: unknown): TrackChange | null {
  return isRecord(raw) && isId(raw.id) ? { type: 'upsert', track: restoreNulls(raw as WireTrack, TRACK_NULLABLE) } : null;
}

export function decodeTrackUpdate(raw: unknown): TrackChange | null {
  return isRecord(raw) && isId(raw.id) ? { type: 'patch', track: raw as RowPatch } : null;
}

export function decodeTrackRemove(raw: unknown): TrackChange | null {
  return isId(raw) ? { type: 'remove', trackId: raw } : null;
}

export function decodeTrackOrder(raw: unknown): TrackChange | null {
  return Array.isArray(raw) && raw.every(isId) ? { type: 'reorder', order: raw } : null;
}

type Decoder<T> = (raw: unknown) => T | null;

/** Every clip event with its decoder, so a client registers them in one loop. */
export const CLIP_EVENTS: ReadonlyArray<readonly [TimelineEventName, Decoder<ClipChange>]> = [
  [TimelineEvent.clipAdd,    decodeClipAdd],
  [TimelineEvent.clipUpdate, decodeClipUpdate],
  [TimelineEvent.clipRemove, decodeClipRemove],
];

export const TRACK_EVENTS: ReadonlyArray<readonly [TimelineEventName, Decoder<TrackChange>]> = [
  [TimelineEvent.trackAdd,    decodeTrackAdd],
  [TimelineEvent.trackUpdate, decodeTrackUpdate],
  [TimelineEvent.trackRemove, decodeTrackRemove],
  [TimelineEvent.trackOrder,  decodeTrackOrder],
];

// ── Presence ──────────────────────────────────────────────────────────────────

export interface PresenceUser {
  id: string;
  name: string;
  avatarImageId: string | null;
  /** When the account was created, to the second; the avatar's fallback colour comes from it. Null for a device. */
  createdAt: string | null;
}

/** What the server knows about an occupant, before encoding. */
export interface PresenceSource {
  id: string;
  name: string;
  avatarImageId: string | null;
  createdAt: Date | string | null;
}

/** `[id, name]`, `[id, name, avatarImageId]`, or `[id, name, avatarImageId | null, createdAt in epoch seconds]`. */
export type PresenceWire = [string, string, (string | null)?, number?];

export function encodePresence(users: readonly PresenceSource[]): PresenceWire[] {
  return users.map(({ id, name, avatarImageId, createdAt }): PresenceWire => {
    const ms = createdAt === null ? NaN : new Date(createdAt).getTime();
    if (Number.isFinite(ms)) return [id, name, avatarImageId, Math.floor(ms / 1000)];
    return avatarImageId ? [id, name, avatarImageId] : [id, name];
  });
}

export function decodePresence(raw: unknown): PresenceUser[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): PresenceUser[] => {
    if (!Array.isArray(entry) || !isId(entry[0]) || typeof entry[1] !== 'string') return [];
    const [id, name, avatarImageId, createdAt] = entry as unknown[];
    return [{
      id:            id as string,
      name:          name as string,
      avatarImageId: typeof avatarImageId === 'string' ? avatarImageId : null,
      createdAt:     isNumber(createdAt) ? new Date(createdAt * 1000).toISOString() : null,
    }];
  });
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

// ── Transport ─────────────────────────────────────────────────────────────────

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
  at: number;
}

/** `[playing ? 1 : 0, frame, at, frameRate]`. */
export type AnchorWire = [0 | 1, number, number, number];

export const encodeAnchor = (state: TransportState): AnchorWire =>
  [state.playing ? 1 : 0, state.frame, state.at, state.frameRate];

export function decodeAnchor(raw: unknown): TransportState | null {
  if (!Array.isArray(raw) || !isFlag(raw[0]) || !isNumber(raw[1]) || !isNumber(raw[2]) || !isNumber(raw[3])) return null;
  return { playing: raw[0] === 1, frame: raw[1], at: raw[2], frameRate: raw[3] };
}

export type TransportAction = 'play' | 'pause' | 'seek';

export interface TransportCommand {
  action: TransportAction;
  /** Required for play and seek; ignored for pause, which reads the server clock. */
  frame?: number;
}

/** `[0]` pause, `[1, frame]` play, `[2, frame]` seek. The codes line up with an anchor's playing flag. */
export type TransportCommandWire = [0] | [1 | 2, number];

const ACTIONS: readonly TransportAction[] = ['pause', 'play', 'seek'];

export function encodeCommand({ action, frame }: TransportCommand): TransportCommandWire {
  if (action === 'pause') return [0];
  // A missing frame goes out as null and the server drops the command, as it did
  // before the wire was compact.
  return [action === 'play' ? 1 : 2, frame as number];
}

export function decodeCommand(raw: unknown): TransportCommand | null {
  if (!Array.isArray(raw)) return null;
  if (raw[0] === 0) return { action: 'pause' };
  if ((raw[0] === 1 || raw[0] === 2) && isNumber(raw[1])) return { action: ACTIONS[raw[0]]!, frame: raw[1] };
  return null;
}

// ── Clock resync ──────────────────────────────────────────────────────────────
// Before a show, an operator presses "Sync clocks": every client in the room
// re-measures its clock against the server and reports how good its estimate
// now is. While that runs, the server holds any Play, so nobody starts the show
// on an estimate still being refined. Rules: apps/api/src/lib/clockResync.ts.
//
// The run is sent whole once, as it starts, and to anyone joining mid-run.
// After that the room hears only what changed, a few times a second at most —
// the whole table on every report made a run cost the square of the room.

export interface ClockMeasureRequest {
  requestId: string;
  /** Answer within this many ms, or be listed as not answering. */
  deadlineMs: number;
}

/** `[requestId, deadlineMs]`. */
export type MeasureWire = [string, number];

export const encodeMeasure = (request: ClockMeasureRequest): MeasureWire => [request.requestId, request.deadlineMs];

export function decodeMeasure(raw: unknown): ClockMeasureRequest | null {
  if (!Array.isArray(raw) || !isId(raw[0]) || !isNumber(raw[1])) return null;
  return { requestId: raw[0], deadlineMs: raw[1] };
}

export interface ClockReport {
  requestId: string;
  /**
   * Round trip (ms) of the sample the client's estimate rests on — its offset is
   * never wrong by more than half this. Null when no ping answered at all.
   */
  rtt: number | null;
}

/** `[requestId, rtt | null]`. */
export type ReportWire = [string, number | null];

export const encodeReport = (report: ClockReport): ReportWire => [report.requestId, report.rtt];

export function decodeReport(raw: unknown): ClockReport | null {
  if (!Array.isArray(raw) || !isId(raw[0])) return null;
  const rtt = raw[1];
  if (rtt !== null && !(isNumber(rtt) && rtt >= 0)) return null;
  return { requestId: raw[0], rtt };
}

/**
 * - `waiting`   asked, has not answered yet
 * - `synced`    answered with a measured estimate
 * - `failed`    answered, but no ping got through
 * - `no-report` the deadline passed first — an older client, or a stuck one
 * - `left`      disconnected or left the room mid-run
 *
 * On the wire a state is its index in this list.
 */
export const CLOCK_CLIENT_STATES = ['waiting', 'synced', 'failed', 'no-report', 'left'] as const;

export type ClockClientState = (typeof CLOCK_CLIENT_STATES)[number];

export interface ClockClientStatus {
  /** Presence id; a device's carries TOKEN_PRESENCE_PREFIX. */
  id: string;
  name: string;
  state: ClockClientState;
  rtt: number | null;
}

export interface ClockSyncStatus {
  requestId: string;
  state: 'measuring' | 'done';
  requestedBy: { name: string };
  deadlineMs: number;
  /** A Play is waiting for this run to end, and starts the moment it does. */
  playHeld: boolean;
  /** One entry per socket: two tabs are two clocks. The order never changes during a run. */
  clients: ClockClientStatus[];
}

/** What changed in a run since the room last heard. `index` is the client's place in `clients`. */
export interface ClockSyncProgress {
  requestId: string;
  state: 'measuring' | 'done';
  playHeld: boolean;
  changes: Array<{ index: number; state: ClockClientState; rtt: number | null }>;
}

/** `[id, name, state, rtt?]`. */
export type ClockClientWire = [string, string, number, number?];

/** `[requestId, done, playHeld, requestedByName, deadlineMs, clients]`. */
export type StatusWire = [string, 0 | 1, 0 | 1, string, number, ClockClientWire[]];

/** `[requestId, done, playHeld, [index, state, rtt?][]]`. */
export type ProgressWire = [string, 0 | 1, 0 | 1, Array<[number, number, number?]>];

const stateCode = (state: ClockClientState): number => CLOCK_CLIENT_STATES.indexOf(state);
const stateAt   = (code: unknown): ClockClientState | null =>
  (typeof code === 'number' && CLOCK_CLIENT_STATES[code]) || null;
const rttOf     = (v: unknown): number | null => (isNumber(v) && v >= 0 ? v : null);

export function encodeStatus(status: ClockSyncStatus): StatusWire {
  return [
    status.requestId,
    status.state === 'done' ? 1 : 0,
    status.playHeld ? 1 : 0,
    status.requestedBy.name,
    status.deadlineMs,
    status.clients.map(({ id, name, state, rtt }): ClockClientWire =>
      (rtt === null ? [id, name, stateCode(state)] : [id, name, stateCode(state), rtt])),
  ];
}

export function decodeStatus(raw: unknown): ClockSyncStatus | null {
  if (!Array.isArray(raw) || !isId(raw[0]) || !isFlag(raw[1]) || !isFlag(raw[2])
    || typeof raw[3] !== 'string' || !isNumber(raw[4]) || !Array.isArray(raw[5])) return null;
  const clients: ClockClientStatus[] = [];
  for (const entry of raw[5] as unknown[]) {
    const state = Array.isArray(entry) ? stateAt(entry[2]) : null;
    if (!Array.isArray(entry) || !isId(entry[0]) || typeof entry[1] !== 'string' || !state) return null;
    clients.push({ id: entry[0], name: entry[1], state, rtt: rttOf(entry[3]) });
  }
  return {
    requestId:   raw[0],
    state:       raw[1] === 1 ? 'done' : 'measuring',
    playHeld:    raw[2] === 1,
    requestedBy: { name: raw[3] },
    deadlineMs:  raw[4],
    clients,
  };
}

export function encodeProgress(progress: ClockSyncProgress): ProgressWire {
  return [
    progress.requestId,
    progress.state === 'done' ? 1 : 0,
    progress.playHeld ? 1 : 0,
    progress.changes.map(({ index, state, rtt }): [number, number, number?] =>
      (rtt === null ? [index, stateCode(state)] : [index, stateCode(state), rtt])),
  ];
}

/**
 * Folds a progress message into the run it belongs to.
 *
 * Returns a new status when it applies — never the same object changed, so a
 * reactive view notices — and `current` untouched when the message is malformed
 * or for a run this client never saw whole.
 */
export function applyProgress(current: ClockSyncStatus | null, raw: unknown): ClockSyncStatus | null {
  if (!current || !Array.isArray(raw) || raw[0] !== current.requestId
    || !isFlag(raw[1]) || !isFlag(raw[2]) || !Array.isArray(raw[3])) return current;
  const clients = [...current.clients];
  for (const change of raw[3] as unknown[]) {
    if (!Array.isArray(change)) continue;
    const [index, code, rtt] = change as unknown[];
    const state = stateAt(code);
    if (typeof index !== 'number' || !clients[index] || !state) continue;
    clients[index] = { ...clients[index]!, state, rtt: rttOf(rtt) };
  }
  return { ...current, state: raw[1] === 1 ? 'done' : 'measuring', playHeld: raw[2] === 1, clients };
}

export type ClockResyncAck = { ok: true; requestId: string } | { error: string };

// ── Joining ───────────────────────────────────────────────────────────────────

/**
 * What `join` acks with: the joiner's capabilities, and everything about the
 * room it would otherwise need separate messages for. `anchor` is there only
 * while the room plays; `sync` only while a clock resync runs.
 */
export type JoinAck =
  | {
      ok: true;
      protocol: number;
      canEdit: boolean;
      canRename: boolean;
      users: PresenceWire[];
      anchor?: AnchorWire;
      sync?: StatusWire;
    }
  | { error: string };
