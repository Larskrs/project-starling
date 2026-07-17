import type { Server as SocketIOServer, Socket } from 'socket.io';
import { eq } from 'drizzle-orm';
import { db, timelines, productions } from '@starling/db';
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

/** Transport state broadcast so every client shows the same current time. */
export interface PlayheadState {
  frame:     number;
  isPlaying: boolean;
}

interface ServerToClientEvents {
  'timeline:presence': (users: PresenceUser[]) => void;
  'clip:change':       (change: ClipChange) => void;
  'track:change':      (change: TrackChange) => void;
  // `at` = server epoch ms at relay time. Receivers age the state against
  // their measured clock offset (see time:ping) so they land where the
  // sender's playhead IS, not where it was when the message left.
  'playhead:sync':     (state: PlayheadState & { userId: string; at: number }) => void;
}

type AckResult = { ok: true } | { error: string };
type Ack       = (result: AckResult) => void;

interface ClientToServerEvents {
  'timeline:join':  (payload: { timelineId: string }, ack?: Ack) => void;
  'timeline:leave': () => void;
  'clip:change':    (change: ClipChange) => void;
  'track:change':   (change: TrackChange) => void;
  'playhead:update': (state: PlayheadState) => void;
  // NTP-style clock probe: acks the server's epoch ms so clients can estimate
  // their offset from the server clock (used to age playhead:sync stamps).
  'time:ping':      (ack?: (serverNow: number) => void) => void;
}

interface TimelineSocketData extends SocketData {
  timelineId?: string;
  lastPlayheadAt?: number;
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

// timelineId → the room's shared transport state (one JSON object per socket
// room): whether the timeline is playing, at which frame, who drives it, and
// the server stamp. While the timeline is ACTIVE (playing) this is what late
// joiners are caught up with; a stopped timeline is browsed privately by each
// member, so a stopped state is stored (it ends the run for joiners) but never
// replayed. Cleared when the room empties.
const roomTransport = new Map<string, PlayheadState & { userId: string; at: number }>();

// A stored "playing" state is only replayed while fresh — the driver streams
// one every 500ms, so anything older means playback stopped ungracefully
// (e.g. the driver disconnected mid-play).
const PLAYING_REPLAY_MAX_AGE_MS = 5000;

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

async function resolveTimelineAccess(user: SocketUser, timelineId: string): Promise<AccessLevel | null> {
  const [tl] = await db
    .select({ productionId: timelines.productionId, companyId: productions.companyId })
    .from(timelines)
    .innerJoin(productions, eq(timelines.productionId, productions.id))
    .where(eq(timelines.id, timelineId))
    .limit(1);
  if (!tl) return null;

  return resolveAccessLevel({ id: user.id, role: user.role }, tl.companyId, tl.productionId);
}

/** Whether the resolved access grants a specific production permission. */
function accessGrants(access: AccessLevel, user: SocketUser, required: bigint): boolean {
  if (access.privileged) return true;
  return can(user.role, access.rolePermissions, required);
}

// ── Namespace setup ───────────────────────────────────────────────────────────

const PLAYHEAD_MIN_INTERVAL_MS = 80;        // server-side guard against event floods
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
      void socket.leave(roomName(timelineId));

      const room = rooms.get(timelineId);
      const entry = room?.get(user.id);
      if (!room || !entry) return;
      entry.sockets.delete(socket.id);
      if (entry.sockets.size === 0) room.delete(user.id);
      if (room.size === 0) {
        rooms.delete(timelineId);
        roomTransport.delete(timelineId);
      }
      nsp.to(roomName(timelineId)).emit('timeline:presence', presenceList(timelineId));
    }

    // ── timeline:join ─────────────────────────────────────────────────────
    socket.on('timeline:join', async ({ timelineId }, ack) => {
      if (typeof timelineId !== 'string' || !timelineId) {
        ack?.({ error: 'Invalid timeline id' });
        return;
      }

      let access: AccessLevel | null;
      try {
        access = await resolveTimelineAccess(user, timelineId);
      } catch {
        ack?.({ error: 'Access check failed' });
        return;
      }
      if (!access) {
        ack?.({ error: 'Access denied' });
        return;
      }

      leavePresence(); // a socket follows one timeline at a time
      socket.data.timelineId = timelineId;
      // Cache the edit capabilities for this timeline so the mutation relays
      // below don't hit the DB on every clip/track event.
      socket.data.canEdit   = accessGrants(access, user, Permission.EDIT_TIMELINE);
      socket.data.canRename = accessGrants(access, user, Permission.RENAME_CLIPS);
      await socket.join(roomName(timelineId));
      joinPresence(timelineId);
      socket.emit('timeline:presence', presenceList(timelineId));

      // An ACTIVE timeline is shared: the joiner immediately follows the
      // playing transport (aged from the stamp, landing where the playhead is
      // NOW). A stopped timeline is browsed privately — nothing to replay.
      const state = roomTransport.get(timelineId);
      if (state?.isPlaying && Date.now() - state.at < PLAYING_REPLAY_MAX_AGE_MS) {
        socket.emit('playhead:sync', state);
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
    });

    socket.on('track:change', (change) => {
      const timelineId = socket.data.timelineId;
      if (!timelineId || !socket.data.canEdit) return;
      if (!change) return;
      if (change.type !== 'upsert' && change.type !== 'remove' && change.type !== 'reorder') return;
      if (change.type === 'reorder' && !Array.isArray(change.order)) return;
      if (relayTooLarge(change)) return;
      socket.to(roomName(timelineId)).emit('track:change', change);
    });

    // Playhead sync is a shared-viewing feature, so it stays at join (VIEW)
    // level — any member in the room can drive the synced transport.
    socket.on('playhead:update', (state) => {
      const timelineId = socket.data.timelineId;
      if (!timelineId || !state || typeof state.frame !== 'number' || !Number.isFinite(state.frame)) return;

      const now = Date.now();
      if (socket.data.lastPlayheadAt && now - socket.data.lastPlayheadAt < PLAYHEAD_MIN_INTERVAL_MS) return;
      socket.data.lastPlayheadAt = now;

      const stamped = {
        frame:     state.frame,
        isPlaying: state.isPlaying === true,
        userId:    user.id,
        at:        Date.now(),
      };
      roomTransport.set(timelineId, stamped);
      socket.to(roomName(timelineId)).emit('playhead:sync', stamped);
    });

    socket.on('time:ping', (ack) => {
      if (typeof ack === 'function') ack(Date.now());
    });

    socket.on('disconnect', leavePresence);
  });
}
