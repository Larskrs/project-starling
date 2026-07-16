import type { Server as SocketIOServer, Socket } from 'socket.io';
import { eq, and, or } from 'drizzle-orm';
import { db, timelines, productions, companyMembers, productionMembers, productionRoles } from '@starling/db';
import { socketAuth, type SocketData, type SocketUser } from './sockets.js';
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
  'playhead:sync':     (state: PlayheadState & { userId: string }) => void;
}

type AckResult = { ok: true } | { error: string };
type Ack       = (result: AckResult) => void;

interface ClientToServerEvents {
  'timeline:join':  (payload: { timelineId: string }, ack?: Ack) => void;
  'timeline:leave': () => void;
  'clip:change':    (change: ClipChange) => void;
  'track:change':   (change: TrackChange) => void;
  'playhead:update': (state: PlayheadState) => void;
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

function roomName(timelineId: string): string {
  return `tl:${timelineId}`;
}

function presenceList(timelineId: string): PresenceUser[] {
  return [...(rooms.get(timelineId)?.values() ?? [])].map(e => e.user);
}

// ── Access check ──────────────────────────────────────────────────────────────
// Mirrors requireProductionAccess: global admin, company owner/admin, or explicit
// production membership. Resolves the member's role permission bits in the same
// pass so per-event permission checks (EDIT_TIMELINE) need no extra round-trip.

interface TimelineAccess {
  /** Global admin or company owner/admin — every permission check passes. */
  privileged:      boolean;
  /** The member's role permission bits; null when privileged or role-less. */
  rolePermissions: bigint | null;
}

async function resolveTimelineAccess(user: SocketUser, timelineId: string): Promise<TimelineAccess | null> {
  const [tl] = await db
    .select({ productionId: timelines.productionId, companyId: productions.companyId })
    .from(timelines)
    .innerJoin(productions, eq(timelines.productionId, productions.id))
    .where(eq(timelines.id, timelineId))
    .limit(1);
  if (!tl) return null;

  if (user.role === 'admin') return { privileged: true, rolePermissions: null };

  const [companyMem] = await db.select({ id: companyMembers.id })
    .from(companyMembers)
    .where(and(
      eq(companyMembers.companyId, tl.companyId),
      eq(companyMembers.userId, user.id),
      or(eq(companyMembers.role, 'owner'), eq(companyMembers.role, 'admin')),
    ))
    .limit(1);
  if (companyMem) return { privileged: true, rolePermissions: null };

  const [prodMem] = await db.select({ roleId: productionMembers.roleId, permissions: productionRoles.permissions })
    .from(productionMembers)
    .leftJoin(productionRoles, eq(productionMembers.roleId, productionRoles.id))
    .where(and(
      eq(productionMembers.productionId, tl.productionId),
      eq(productionMembers.userId, user.id),
    ))
    .limit(1);
  if (!prodMem) return null;

  return { privileged: false, rolePermissions: prodMem.permissions ?? null };
}

/** Whether the resolved access grants a specific production permission. */
function accessGrants(access: TimelineAccess, user: SocketUser, required: bigint): boolean {
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
      if (room.size === 0) rooms.delete(timelineId);
      nsp.to(roomName(timelineId)).emit('timeline:presence', presenceList(timelineId));
    }

    // ── timeline:join ─────────────────────────────────────────────────────
    socket.on('timeline:join', async ({ timelineId }, ack) => {
      if (typeof timelineId !== 'string' || !timelineId) {
        ack?.({ error: 'Invalid timeline id' });
        return;
      }

      let access: TimelineAccess | null;
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

      socket.to(roomName(timelineId)).emit('playhead:sync', {
        frame:     state.frame,
        isPlaying: state.isPlaying === true,
        userId:    user.id,
      });
    });

    socket.on('disconnect', leavePresence);
  });
}
