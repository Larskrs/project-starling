import type { Server as SocketIOServer, Socket, Namespace } from 'socket.io';
import { eq } from 'drizzle-orm';
import { db, timelines, productions, tracks, clips } from '@starling/db';
import { socketAuth, type SocketData, type SocketUser } from './sockets.js';
import { resolveAccessLevel, type AccessLevel } from './production.js';
import { can } from './permissions.js';
import { Permission } from '@starling/auth/permissions';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PresenceUser {
  id:            string;
  name:          string;
  avatarImageId: string | null;
  createdAt:     Date;
}

/** Clip create/update ("upsert") or delete ("remove") relayed to other editors. */
export interface ClipChange {
  type:    'upsert' | 'remove';
  trackId: string;
  clip?:   Record<string, unknown>;  // upsert: full clip row from the REST response
  clipId?: string;                   // remove
}

/** Track create/update/delete/reorder relayed to other editors. */
export interface TrackChange {
  type:     'upsert' | 'remove' | 'reorder';
  track?:   Record<string, unknown>;
  trackId?: string;
  order?:   string[];   // reorder: track ids in the new order (index = sortOrder)
}

/**
 * The room's authoritative transport state — the SERVER decides how fast
 * frames go. `frame` is the anchor position at server time `at`; while
 * playing, the position at any server time t is
 * `frame + (t − at)/1000 × frameRate`. Clients never stream positions: they
 * send commands (play/pause/seek) and derive the current frame from this
 * anchor plus their measured clock offset, so a command's network delay
 * cancels out and every client lands on the same frame.
 */
export interface TransportState {
  playing:   boolean;
  frame:     number;   // anchor frame at server time `at`
  frameRate: number;   // fps the server advances the clock with (from the DB)
  userId:    string;   // who issued the last command
  at:        number;   // server epoch ms of the anchor
}

/** A client transport command. `frame` is required for play/seek. */
export interface TransportCommand {
  action: 'play' | 'pause' | 'seek';
  frame?: number;
}

/**
 * Emitted while a room's transport is playing, whenever the clip under the
 * playhead CHANGES on a track — computed by the server from its own clock, so
 * lightweight clients (mobile) can show "now playing" per track without
 * holding the clip model or running their own boundary math.
 */
export interface ActiveClipEvent {
  trackId:  string;
  clipId:   string | null;   // null = the track went silent (a length clip ended)
  label:    string | null;
  sourceId: string | null;   // lets clients prefix the source short name
  frame:    number;          // transport frame at emit time
  at:       number;          // server epoch ms (age it like transport anchors)
}

interface ServerToClientEvents {
  'timeline:presence': (users: PresenceUser[]) => void;
  'clip:change':       (change: ClipChange) => void;
  'track:change':      (change: TrackChange) => void;
  'transport:state':   (state: TransportState) => void;
  'clip:active':       (event: ActiveClipEvent) => void;
}

type AckResult = { ok: true } | { error: string };
type Ack       = (result: AckResult) => void;

interface ClientToServerEvents {
  'timeline:join':  (payload: { timelineId: string }, ack?: Ack) => void;
  'timeline:leave': () => void;
  'clip:change':    (change: ClipChange) => void;
  'track:change':   (change: TrackChange) => void;
  'transport:command': (cmd: TransportCommand) => void;
  // NTP-style clock probe: acks the server's epoch ms so clients can estimate
  // their offset from the server clock (used to evaluate transport anchors).
  'time:ping':      (ack?: (serverNow: number) => void) => void;
}

interface TimelineSocketData extends SocketData {
  timelineId?: string;
  lastSeekAt?: number;
  // The joined timeline's frame rate — resolved from the DB at join so the
  // transport clock can't be driven with a client-supplied fps.
  frameRate?: number;
  // Whether the joined member holds EDIT_TIMELINE for the current timeline.
  // Resolved once at join time and gates the clip/track mutation relays.
  canEdit?: boolean;
  // RENAME_CLIPS holders may relay clip changes too (their label-only PATCHes
  // must reach other editors), but not track changes.
  canRename?: boolean;
}

type TimelineSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, TimelineSocketData>;

// ── Presence state ────────────────────────────────────────────────────────────

// timelineId → userId → { user, socketIds }
const rooms = new Map<string, Map<string, { user: PresenceUser; sockets: Set<string> }>>();

// timelineId → the room's authoritative transport (one JSON object per socket
// room). An anchor never goes stale — playing position is derived from the
// server clock — so late joiners simply receive it while playing; a stopped
// timeline is browsed privately, nothing to replay. Cleared when the room
// empties. (Clients clamp a run that outlived the timeline's end.)
const roomTransport = new Map<string, TransportState>();

// Seek commands can arrive as a scrub burst — bound them per socket.
const SEEK_MIN_INTERVAL_MS = 80;

// ── Active-clip watcher ───────────────────────────────────────────────────────
// While a room's transport plays, the server walks the timeline's clip
// boundaries on its own clock and emits `clip:active` whenever the clip under
// the playhead changes on a track. Semantics mirror the web editor's
// activeClipLabel: a clip is active from `position`; with an `end` it runs for
// `end − mediaStart` frames, otherwise until the next clip on the track.
// Armed on play/seek, reloaded on clip/track edits, disarmed on pause/empty.

interface WatcherClip {
  id:         string;
  trackId:    string;
  position:   number;
  mediaStart: number | null;
  end:        number | null;
  label:      string | null;
  sourceId:   string | null;
}

interface RoomWatcher {
  timer:        ReturnType<typeof setTimeout> | null;
  clipsByTrack: Map<string, WatcherClip[]>;   // sorted by position
  active:       Map<string, string | null>;   // trackId → active clipId
}

const roomWatchers = new Map<string, RoomWatcher>();

function transportFrameAt(state: TransportState, now: number): number {
  return state.playing ? state.frame + ((now - state.at) / 1000) * state.frameRate : state.frame;
}

function activeClipAt(trackClips: WatcherClip[], frame: number): WatcherClip | null {
  let active: WatcherClip | null = null;
  for (const clip of trackClips) {
    if (clip.position > frame) break;
    active = clip;
  }
  if (!active) return null;
  if (active.end != null && frame >= active.position + (active.end - (active.mediaStart ?? 0))) return null;
  return active;
}

/** The next frame at which any track's active clip can change. */
function nextBoundaryAfter(clipsByTrack: Map<string, WatcherClip[]>, frame: number): number | null {
  let next: number | null = null;
  const consider = (b: number | null) => {
    if (b != null && b > frame && (next == null || b < next)) next = b;
  };
  for (const trackClips of clipsByTrack.values()) {
    for (const clip of trackClips) {
      consider(clip.position);
      consider(clip.end != null ? clip.position + (clip.end - (clip.mediaStart ?? 0)) : null);
    }
  }
  return next;
}

function disarmWatcher(timelineId: string): void {
  const watcher = roomWatchers.get(timelineId);
  if (watcher?.timer) clearTimeout(watcher.timer);
  roomWatchers.delete(timelineId);
}

/** (Re)load the timeline's clip windows and start walking boundaries. */
async function armWatcher(nsp: Namespace, timelineId: string): Promise<void> {
  const prev = roomWatchers.get(timelineId);
  if (prev?.timer) clearTimeout(prev.timer);

  const state = roomTransport.get(timelineId);
  if (!state?.playing) { roomWatchers.delete(timelineId); return; }

  const rows = await db
    .select({
      id:         clips.id,
      trackId:    clips.trackId,
      position:   clips.position,
      mediaStart: clips.mediaStart,
      end:        clips.end,
      label:      clips.label,
      sourceId:   clips.sourceId,
    })
    .from(clips)
    .innerJoin(tracks, eq(clips.trackId, tracks.id))
    .where(eq(tracks.timelineId, timelineId))
    .orderBy(clips.position);

  const clipsByTrack = new Map<string, WatcherClip[]>();
  for (const row of rows) {
    const list = clipsByTrack.get(row.trackId);
    if (list) list.push(row);
    else clipsByTrack.set(row.trackId, [row]);
  }

  // Keep the previous active map across re-arms (seeks, edits) so only genuine
  // changes emit; a fresh play starts empty and emits the initial snapshot.
  roomWatchers.set(timelineId, { timer: null, clipsByTrack, active: prev?.active ?? new Map() });
  evaluateWatcher(nsp, timelineId);
}

function evaluateWatcher(nsp: Namespace, timelineId: string): void {
  const watcher = roomWatchers.get(timelineId);
  const state   = roomTransport.get(timelineId);
  if (!watcher || !state?.playing) { disarmWatcher(timelineId); return; }

  const now   = Date.now();
  const frame = transportFrameAt(state, now);

  for (const [trackId, trackClips] of watcher.clipsByTrack) {
    const active = activeClipAt(trackClips, frame);
    if ((active?.id ?? null) === (watcher.active.get(trackId) ?? null)) continue;
    watcher.active.set(trackId, active?.id ?? null);
    nsp.to(roomName(timelineId)).emit('clip:active', {
      trackId,
      clipId:   active?.id ?? null,
      label:    active?.label ?? null,
      sourceId: active?.sourceId ?? null,
      frame,
      at:       now,
    });
  }

  const boundary = nextBoundaryAfter(watcher.clipsByTrack, frame);
  if (boundary == null) return;   // no more changes ahead — sleep until re-armed
  const delayMs = Math.max(10, ((boundary - frame) / state.frameRate) * 1000 + 5);
  watcher.timer = setTimeout(() => evaluateWatcher(nsp, timelineId), delayMs);
}

function roomName(timelineId: string): string {
  return `tl:${timelineId}`;
}

function presenceList(timelineId: string): PresenceUser[] {
  return [...(rooms.get(timelineId)?.values() ?? [])].map(e => e.user);
}

// ── Access check ──────────────────────────────────────────────────────────────
// Resolves the timeline's owning production, then delegates to the same
// membership resolution REST uses (resolveAccessLevel in production.ts), so the
// two layers can never drift.

async function resolveTimelineAccess(
  user: SocketUser,
  timelineId: string,
): Promise<{ level: AccessLevel; frameRate: number } | null> {
  const [tl] = await db
    .select({ productionId: timelines.productionId, companyId: productions.companyId, frameRate: timelines.frameRate })
    .from(timelines)
    .innerJoin(productions, eq(timelines.productionId, productions.id))
    .where(eq(timelines.id, timelineId))
    .limit(1);
  if (!tl) return null;

  const level = await resolveAccessLevel({ id: user.id, role: user.role }, tl.companyId, tl.productionId);
  if (!level) return null;

  return { level, frameRate: parseFloat(tl.frameRate) || 25 };
}

/** Whether the resolved access grants a specific production permission. */
function accessGrants(access: AccessLevel, user: SocketUser, required: bigint): boolean {
  if (access.privileged) return true;
  return can(user.role, access.rolePermissions, required);
}

// ── Namespace setup ───────────────────────────────────────────────────────────

const MAX_RELAY_BYTES          = 32 * 1024; // cap relayed clip/track payloads

// Relays fan a sender's payload out to everyone in the room — bound the size so
// one client can't broadcast megabytes to every peer.
function relayTooLarge(payload: unknown): boolean {
  try { return JSON.stringify(payload).length > MAX_RELAY_BYTES; }
  catch { return true; }
}

export function setupTimelineSockets(io: SocketIOServer): void {
  const nsp = io.of('/timeline');
  nsp.use(socketAuth);

  nsp.on('connection', (rawSocket) => {
    const socket = rawSocket as TimelineSocket;
    const { user } = socket.data;
    const presenceUser: PresenceUser = {
      id:            user.id,
      name:          user.name,
      avatarImageId: user.avatarImageId,
      createdAt:     user.createdAt,
    };

    function joinPresence(timelineId: string): void {
      const room = rooms.get(timelineId) ?? new Map();
      rooms.set(timelineId, room);
      const entry = room.get(user.id) ?? { user: presenceUser, sockets: new Set<string>() };
      room.set(user.id, entry);
      entry.sockets.add(socket.id);
      nsp.to(roomName(timelineId)).emit('timeline:presence', presenceList(timelineId));
    }

    function leavePresence(): void {
      const timelineId = socket.data.timelineId;
      if (!timelineId) return;
      socket.data.timelineId = undefined;
      socket.data.canEdit = undefined;
      socket.data.canRename = undefined;
      socket.data.frameRate = undefined;
      void socket.leave(roomName(timelineId));

      const room = rooms.get(timelineId);
      const entry = room?.get(user.id);
      if (!room || !entry) return;
      entry.sockets.delete(socket.id);
      if (entry.sockets.size === 0) room.delete(user.id);
      if (room.size === 0) {
        rooms.delete(timelineId);
        roomTransport.delete(timelineId);
        disarmWatcher(timelineId);
      }
      nsp.to(roomName(timelineId)).emit('timeline:presence', presenceList(timelineId));
    }

    // ── timeline:join ─────────────────────────────────────────────────────
    socket.on('timeline:join', async ({ timelineId }, ack) => {
      if (typeof timelineId !== 'string' || !timelineId) {
        ack?.({ error: 'Invalid timeline id' });
        return;
      }

      let resolved: { level: AccessLevel; frameRate: number } | null;
      try {
        resolved = await resolveTimelineAccess(user, timelineId);
      } catch {
        ack?.({ error: 'Access check failed' });
        return;
      }
      if (!resolved) {
        ack?.({ error: 'Access denied' });
        return;
      }
      const access = resolved.level;

      leavePresence(); // a socket follows one timeline at a time
      socket.data.timelineId = timelineId;
      socket.data.frameRate  = resolved.frameRate;
      // Cache the edit capabilities for this timeline so the mutation relays
      // below don't hit the DB on every clip/track event.
      socket.data.canEdit   = accessGrants(access, user, Permission.EDIT_TIMELINE);
      socket.data.canRename = accessGrants(access, user, Permission.RENAME_CLIPS);
      await socket.join(roomName(timelineId));
      joinPresence(timelineId);
      socket.emit('timeline:presence', presenceList(timelineId));

      // An ACTIVE timeline is shared: the joiner receives the authoritative
      // anchor and derives the current frame from it — anchors never go stale.
      // A stopped timeline is browsed privately — nothing to replay.
      const state = roomTransport.get(timelineId);
      if (state?.playing) {
        socket.emit('transport:state', state);

        // Catch the joiner up on what's currently active per track.
        const watcher = roomWatchers.get(timelineId);
        if (watcher) {
          const now   = Date.now();
          const frame = transportFrameAt(state, now);
          for (const [trackId, clipId] of watcher.active) {
            if (clipId == null) continue;
            const clip = watcher.clipsByTrack.get(trackId)?.find(c => c.id === clipId);
            socket.emit('clip:active', {
              trackId,
              clipId,
              label:    clip?.label ?? null,
              sourceId: clip?.sourceId ?? null,
              frame,
              at:       now,
            });
          }
        }
      }

      ack?.({ ok: true });
    });

    socket.on('timeline:leave', leavePresence);

    // ── Relays ────────────────────────────────────────────────────────────
    // REST is the source of truth for clip/track data; the socket only
    // fans out the change the sender already persisted. Broadcasting a clip
    // or track mutation requires EDIT_TIMELINE — the same permission the REST
    // mutation routes enforce — so a view-only member can't inject forged
    // changes into other editors' timelines.

    socket.on('clip:change', (change) => {
      const timelineId = socket.data.timelineId;
      if (!timelineId || (!socket.data.canEdit && !socket.data.canRename)) return;
      if (!change || typeof change.trackId !== 'string') return;
      if (change.type !== 'upsert' && change.type !== 'remove') return;
      // Rename-only members persist label PATCHes (upserts) — they have no
      // REST path to a remove, so don't let them relay one either.
      if (!socket.data.canEdit && change.type !== 'upsert') return;
      if (relayTooLarge(change)) return;
      socket.to(roomName(timelineId)).emit('clip:change', change);

      // Clip windows changed — reload the active-clip watcher if one is armed.
      if (roomWatchers.has(timelineId)) void armWatcher(nsp, timelineId).catch(() => {});
    });

    socket.on('track:change', (change) => {
      const timelineId = socket.data.timelineId;
      if (!timelineId || !socket.data.canEdit) return;
      if (!change) return;
      if (change.type !== 'upsert' && change.type !== 'remove' && change.type !== 'reorder') return;
      if (change.type === 'reorder' && !Array.isArray(change.order)) return;
      if (relayTooLarge(change)) return;
      socket.to(roomName(timelineId)).emit('track:change', change);

      // A removed track takes its clips along — refresh the watcher if armed.
      if (change.type === 'remove' && roomWatchers.has(timelineId)) {
        void armWatcher(nsp, timelineId).catch(() => {});
      }
    });

    // Transport commands — the server OWNS the clock. A command updates the
    // room's anchor and the resulting authoritative state goes to the whole
    // room INCLUDING the sender, so every client (initiator too) derives its
    // position from the same server anchor. Stays at join (VIEW) level — any
    // member can drive the shared transport.
    socket.on('transport:command', (cmd) => {
      const timelineId = socket.data.timelineId;
      if (!timelineId || !cmd) return;
      if (cmd.action !== 'play' && cmd.action !== 'pause' && cmd.action !== 'seek') return;

      const now  = Date.now();
      const prev = roomTransport.get(timelineId);

      let next: TransportState;
      if (cmd.action === 'play') {
        if (typeof cmd.frame !== 'number' || !Number.isFinite(cmd.frame)) return;
        next = {
          playing:   true,
          frame:     cmd.frame,
          frameRate: socket.data.frameRate ?? 25,
          userId:    user.id,
          at:        now,
        };
      } else if (cmd.action === 'seek') {
        if (typeof cmd.frame !== 'number' || !Number.isFinite(cmd.frame)) return;
        // Stopped timelines are browsed privately — shared seeks exist only
        // while the transport is running. Scrub bursts are rate-bounded.
        if (!prev?.playing) return;
        if (socket.data.lastSeekAt && now - socket.data.lastSeekAt < SEEK_MIN_INTERVAL_MS) return;
        socket.data.lastSeekAt = now;
        next = { ...prev, frame: cmd.frame, userId: user.id, at: now };
      } else {
        // pause: idempotent — the frame is computed from the SERVER clock, not
        // taken from the client, so everyone stops at the authoritative spot.
        if (!prev?.playing) return;
        next = {
          playing:   false,
          frame:     prev.frame + ((now - prev.at) / 1000) * prev.frameRate,
          frameRate: prev.frameRate,
          userId:    user.id,
          at:        now,
        };
      }

      roomTransport.set(timelineId, next);
      nsp.to(roomName(timelineId)).emit('transport:state', next);

      // Keep the active-clip watcher in step with the transport.
      if (next.playing) void armWatcher(nsp, timelineId).catch(() => {});
      else disarmWatcher(timelineId);
    });

    socket.on('time:ping', (ack) => {
      if (typeof ack === 'function') ack(Date.now());
    });

    socket.on('disconnect', leavePresence);
  });
}
