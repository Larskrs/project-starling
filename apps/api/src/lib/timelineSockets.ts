import type { Server as SocketIOServer, Socket } from 'socket.io';
import { eq, and, or } from 'drizzle-orm';
import { db, timelines, productions, companyMembers, productionMembers } from '@starling/db';
import { socketAuth, type SocketData, type SocketUser } from './sockets.js';

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

/** Track create/update/delete relayed to other editors. */
export interface TrackChange {
  type:     'upsert' | 'remove';
  track?:   Record<string, unknown>;
  trackId?: string;
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
// Mirrors requireProductionAccess: global admin, company owner/admin,
// or explicit production membership.

async function canAccessTimeline(user: SocketUser, timelineId: string): Promise<boolean> {
  const [tl] = await db
    .select({ productionId: timelines.productionId, companyId: productions.companyId })
    .from(timelines)
    .innerJoin(productions, eq(timelines.productionId, productions.id))
    .where(eq(timelines.id, timelineId))
    .limit(1);
  if (!tl) return false;

  if (user.role === 'admin') return true;

  const [companyMem] = await db.select({ id: companyMembers.id })
    .from(companyMembers)
    .where(and(
      eq(companyMembers.companyId, tl.companyId),
      eq(companyMembers.userId, user.id),
      or(eq(companyMembers.role, 'owner'), eq(companyMembers.role, 'admin')),
    ))
    .limit(1);
  if (companyMem) return true;

  const [prodMem] = await db.select({ id: productionMembers.id })
    .from(productionMembers)
    .where(and(
      eq(productionMembers.productionId, tl.productionId),
      eq(productionMembers.userId, user.id),
    ))
    .limit(1);
  return !!prodMem;
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

      try {
        if (!(await canAccessTimeline(user, timelineId))) {
          ack?.({ error: 'Access denied' });
          return;
        }
      } catch {
        ack?.({ error: 'Access check failed' });
        return;
      }

      leavePresence(); // a socket follows one timeline at a time
      socket.data.timelineId = timelineId;
      await socket.join(roomName(timelineId));
      joinPresence(timelineId);
      socket.emit('timeline:presence', presenceList(timelineId));
      ack?.({ ok: true });
    });

    socket.on('timeline:leave', leavePresence);

    // ── Relays ────────────────────────────────────────────────────────────
    // REST is the source of truth for clip/track data; the socket only
    // fans out the change the sender already persisted.

    socket.on('clip:change', (change) => {
      const timelineId = socket.data.timelineId;
      if (!timelineId || !change || typeof change.trackId !== 'string') return;
      if (change.type !== 'upsert' && change.type !== 'remove') return;
      if (relayTooLarge(change)) return;
      socket.to(roomName(timelineId)).emit('clip:change', change);
    });

    socket.on('track:change', (change) => {
      const timelineId = socket.data.timelineId;
      if (!timelineId || !change) return;
      if (change.type !== 'upsert' && change.type !== 'remove') return;
      if (relayTooLarge(change)) return;
      socket.to(roomName(timelineId)).emit('track:change', change);
    });

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
