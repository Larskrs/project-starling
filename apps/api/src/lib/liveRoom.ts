import type { Namespace, Server as SocketIOServer, Socket } from 'socket.io';
import { socketAuth, type SocketData, type SocketUser } from './sockets.js';

/**
 * The machinery every live namespace needs, extracted once.
 *
 * Rooms, presence, join/leave, permission-caching and the outside-in emitter
 * were previously written out in full inside each namespace file — around 150
 * lines of identical bookkeeping before a single feature-specific line. That
 * made "add live updates to X" a copy-paste job, and copy-paste is where the
 * subtle divergences live: one namespace remembering to dedupe presence across
 * a user's tabs and the next one forgetting.
 *
 * What stays namespace-specific is the interesting part — which permissions to
 * cache, which events to relay, what to do on join. Those arrive as options.
 */

/** Whatever the caller resolved at join time and wants cached on the socket. */
export interface LiveRoomSocketData<TCaps> extends SocketData {
  roomId?: string;
  caps?: TCaps;
}

export type LiveSocket<TCaps> = Socket<
  Record<string, (...args: never[]) => void>,
  Record<string, (...args: never[]) => void>,
  Record<string, never>,
  LiveRoomSocketData<TCaps>
>;

export interface JoinResult<TCaps, TPresence> {
  /** Capabilities cached on the socket, so relays don't hit the DB per event. */
  caps: TCaps;
  /** How this member appears in the room's presence list. */
  presence: TPresence;
}

export interface LiveRoomOptions<TCaps, TPresence extends { id: string }> {
  /** Socket.IO namespace path, e.g. '/timeline'. */
  namespace: string;
  /** Room key prefix, e.g. 'tl' → room 'tl:<id>'. */
  roomPrefix: string;
  /** Event a client sends to enter a room. */
  joinEvent: string;
  /** Event a client sends to leave without disconnecting. */
  leaveEvent: string;
  /** Event the server broadcasts the occupant list on. */
  presenceEvent: string;
  /** Field on the join payload naming the room, e.g. 'timelineId'. */
  roomIdField: string;

  /**
   * Resolve access and capabilities. Returning null denies the join — the same
   * answer for "no such room" and "no permission", so membership is not
   * probeable from outside.
   *
   * Takes the whole socket data rather than just the user because the presence
   * identity and the access identity are different things for a machine token.
   * Must stay side-effect free: the revalidation sweep below re-runs it on a
   * timer for every connected socket.
   */
  authorize(data: SocketData, roomId: string): Promise<JoinResult<TCaps, TPresence> | null>;

  /** Ran after a successful join, for activity logging or catch-up state. */
  onJoined?(socket: LiveSocket<TCaps>, roomId: string, caps: TCaps): void;
  /** Ran as a socket leaves, before presence is recomputed. */
  onLeaving?(socket: LiveSocket<TCaps>, roomId: string): void;
  /** Ran when a room empties, for tearing down per-room state. */
  onRoomEmpty?(roomId: string): void;
  /** Register the namespace's own event handlers. */
  events?(socket: LiveSocket<TCaps>, ctx: LiveRoomContext<TCaps, TPresence>): void;
}

export interface LiveRoomContext<TCaps, TPresence extends { id: string }> {
  nsp: Namespace;
  roomName(roomId: string): string;
  occupants(roomId: string): TPresence[];
  /** Broadcast to a room from outside any socket — REST routes, timers. */
  emit(roomId: string, event: string, payload: unknown): void;
  /** Broadcast to everyone in a room EXCEPT one socket id. */
  emitExcept(roomId: string, exceptSocketId: string | null, event: string, payload: unknown): void;
}

export function createLiveRoom<TCaps, TPresence extends { id: string }>(
  io: SocketIOServer,
  options: LiveRoomOptions<TCaps, TPresence>,
): LiveRoomContext<TCaps, TPresence> {
  const nsp = io.of(options.namespace);
  nsp.use(socketAuth);

  // roomId → userId → { presence, socketIds }
  const rooms = new Map<string, Map<string, { presence: TPresence; sockets: Set<string> }>>();

  const roomName = (roomId: string): string => `${options.roomPrefix}:${roomId}`;

  const occupants = (roomId: string): TPresence[] =>
    [...(rooms.get(roomId)?.values() ?? [])].map(e => e.presence);

  function emit(roomId: string, event: string, payload: unknown): void {
    nsp.to(roomName(roomId)).emit(event as never, payload as never);
  }

  /**
   * The originator of a REST write is usually already showing the change
   * optimistically, so echoing it back is wasted work at best and a fight with
   * their in-flight state at worst. `except` is a no-op when the id is null,
   * which is what happens for a caller with no socket at all.
   */
  function emitExcept(roomId: string, exceptSocketId: string | null, event: string, payload: unknown): void {
    const target = exceptSocketId
      ? nsp.to(roomName(roomId)).except(exceptSocketId)
      : nsp.to(roomName(roomId));
    target.emit(event as never, payload as never);
  }

  const ctx: LiveRoomContext<TCaps, TPresence> = { nsp, roomName, occupants, emit, emitExcept };

  nsp.on('connection', (rawSocket) => {
    const socket = rawSocket as LiveSocket<TCaps>;
    const { user } = socket.data;

    function broadcastPresence(roomId: string): void {
      nsp.to(roomName(roomId)).emit(options.presenceEvent as never, occupants(roomId) as never);
    }

    function leave(): void {
      const roomId = socket.data.roomId;
      if (!roomId) return;

      options.onLeaving?.(socket, roomId);

      socket.data.roomId = undefined;
      socket.data.caps = undefined;
      void socket.leave(roomName(roomId));

      const room = rooms.get(roomId);
      const entry = room?.get(user.id);
      if (!room || !entry) return;

      // Presence is per USER across their tabs: they are present until the LAST
      // of their sockets goes. Without this, closing one tab would announce
      // someone had left while they are still sitting in another.
      entry.sockets.delete(socket.id);
      if (entry.sockets.size === 0) room.delete(user.id);
      if (room.size === 0) {
        rooms.delete(roomId);
        options.onRoomEmpty?.(roomId);
      }
      broadcastPresence(roomId);
    }

    socket.on(options.joinEvent, async (payload: Record<string, unknown> = {}, ack?: (r: unknown) => void) => {
      const roomId = payload?.[options.roomIdField];
      if (typeof roomId !== 'string' || !roomId) {
        ack?.({ error: 'Invalid room id' });
        return;
      }

      let resolved: JoinResult<TCaps, TPresence> | null;
      try {
        resolved = await options.authorize(socket.data, roomId);
      } catch {
        ack?.({ error: 'Access check failed' });
        return;
      }
      // One answer for "denied" and "does not exist", so room ids are not
      // enumerable by anyone who can connect.
      if (!resolved) {
        ack?.({ error: 'Access denied' });
        return;
      }

      leave();   // a socket follows one room at a time

      socket.data.roomId = roomId;
      socket.data.caps = resolved.caps;
      await socket.join(roomName(roomId));

      const room = rooms.get(roomId) ?? new Map();
      rooms.set(roomId, room);
      const entry = room.get(user.id) ?? { presence: resolved.presence, sockets: new Set<string>() };
      entry.presence = resolved.presence;
      room.set(user.id, entry);
      entry.sockets.add(socket.id);

      // Everyone already in the room hears about the joiner from the broadcast;
      // the joiner gets the list directly, before its ack, so an ack-ordered
      // client never paints an empty list. It is excluded from the broadcast —
      // which would otherwise reach it too, sending it the same list twice on
      // every join.
      const list = occupants(roomId);
      nsp.to(roomName(roomId)).except(socket.id).emit(options.presenceEvent as never, list as never);
      socket.emit(options.presenceEvent as never, list as never);

      options.onJoined?.(socket, roomId, resolved.caps);
      ack?.({ ok: true, ...(resolved.caps as object) });
    });

    socket.on(options.leaveEvent, leave);
    socket.on('disconnect', leave);

    options.events?.(socket, ctx);
  });

  startRevalidation(nsp, options);
  return ctx;
}

/**
 * How long a capability may outlive the access that granted it.
 *
 * Capabilities are resolved once at join and cached on the socket, which is
 * what keeps relays off the database. The cost is that revoking access used to
 * do nothing at all to a live connection: the socket kept the permissions it
 * held when it arrived, indefinitely. Signing out did not close your socket
 * either.
 *
 * This is the bound on that. Sixty seconds is also the guarantee the
 * integration docs promise for token revocation, so the two must not drift.
 */
export const REVALIDATE_INTERVAL_MS = 60_000;

/**
 * Re-resolves every joined socket's capabilities on a timer, and disconnects
 * the ones that no longer have access.
 *
 * One timer per namespace rather than one per socket: a thousand sockets would
 * otherwise be a thousand timers, and the work is the same either way. It costs
 * one `authorize` per joined socket per minute, which also catches role edits
 * and membership changes — not only revoked tokens.
 */
function startRevalidation<TCaps, TPresence extends { id: string }>(
  nsp: Namespace,
  options: LiveRoomOptions<TCaps, TPresence>,
): void {
  const timer = setInterval(async () => {
    for (const rawSocket of nsp.sockets.values()) {
      const socket = rawSocket as LiveSocket<TCaps>;
      const roomId = socket.data.roomId;
      if (!roomId) continue;   // connected but not in a room — nothing cached

      try {
        const resolved = await options.authorize(socket.data, roomId);
        if (!resolved) {
          // Access is gone: revoked, expired, or the role lost the production.
          // Told plainly so a client can distinguish it from a network drop and
          // stop reconnecting.
          socket.emit('access:revoked' as never, { roomId } as never);
          socket.disconnect(true);
          continue;
        }
        // Narrowed as well as widened — a role that loses EDIT_TIMELINE stops
        // being able to write without anyone restarting anything.
        socket.data.caps = resolved.caps;
      } catch {
        // A failed check is not proof of lost access. Leaving the socket alone
        // means a database blip cannot disconnect an entire show; the next
        // sweep will settle it.
      }
    }
  }, REVALIDATE_INTERVAL_MS);

  // Never hold the process open for this.
  timer.unref();
}
