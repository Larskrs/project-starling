import type { Namespace, Server as SocketIOServer, Socket } from 'socket.io';
import { PROTOCOL_ERROR, type ProtocolErrorData } from '@starling/realtime';
import { socketAuth, type SocketData } from './sockets.js';

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
  /** The room's presence version this socket has already been sent. */
  presenceVersion?: number;
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
  /** Event a client sends, with the room id as its payload, to enter a room. */
  joinEvent: string;
  /** Event a client sends to leave without disconnecting. */
  leaveEvent: string;
  /** Event the server broadcasts the occupant list on. */
  presenceEvent: string;
  /**
   * The wire protocol the namespace speaks. A handshake declaring any other is
   * refused before authentication; see PROTOCOL in @starling/realtime.
   */
  protocol: number;
  /** The occupant list as it travels, in join acks and presence broadcasts. */
  encodePresence(list: TPresence[]): unknown;

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

  /**
   * Ran after a successful join. Whatever it returns is added to the join's ack:
   * the joiner's capabilities and the room's live state, which would otherwise
   * each be a message of their own.
   */
  onJoined?(socket: LiveSocket<TCaps>, roomId: string, caps: TCaps): Record<string, unknown> | void;
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

/**
 * How long a presence change waits for company before the room hears it.
 *
 * Every join and leave used to send the whole occupant list to the whole room
 * straight away, so a room of n filling up cost n² lists — and rooms fill up all
 * at once exactly when it matters: a show starting, or every device reconnecting
 * after the API restarts. A quarter of a second folds such a burst into one list
 * per socket. The joiner does not wait for it; its list comes in the join ack.
 */
export const PRESENCE_SETTLE_MS = 250;

interface Room<TPresence> {
  /** userId → presence and that user's sockets here. */
  members: Map<string, { presence: TPresence; sockets: Set<string> }>;
  /** Moves on every change to who is present. */
  version: number;
  flush: ReturnType<typeof setTimeout> | null;
}

export function createLiveRoom<TCaps, TPresence extends { id: string }>(
  io: SocketIOServer,
  options: LiveRoomOptions<TCaps, TPresence>,
): LiveRoomContext<TCaps, TPresence> {
  const nsp = io.of(options.namespace);

  // The protocol is checked before the credential. An outdated client learns why
  // it cannot connect in one round trip instead of misreading every event, and
  // costs no token lookup — which matters most when a room full of old devices
  // reconnects at once.
  nsp.use((socket, next) => {
    const declared = (socket.handshake.auth as { protocol?: unknown } | undefined)?.protocol;
    if (declared === options.protocol) return next();
    const err = new Error(PROTOCOL_ERROR) as Error & { data: ProtocolErrorData };
    err.data = { protocol: options.protocol };
    next(err);
  });
  nsp.use(socketAuth);

  const rooms = new Map<string, Room<TPresence>>();

  const roomName = (roomId: string): string => `${options.roomPrefix}:${roomId}`;

  const occupants = (roomId: string): TPresence[] =>
    [...(rooms.get(roomId)?.members.values() ?? [])].map(e => e.presence);

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

  /** Sends the settled list to every socket in the room that does not have it yet. */
  function flushPresence(roomId: string): void {
    const room = rooms.get(roomId);
    if (!room) return;
    room.flush = null;

    const behind: string[] = [];
    for (const socketId of nsp.adapter.rooms.get(roomName(roomId)) ?? []) {
      const member = nsp.sockets.get(socketId) as LiveSocket<TCaps> | undefined;
      if (!member || member.data.presenceVersion === room.version) continue;
      member.data.presenceVersion = room.version;
      behind.push(socketId);
    }
    if (behind.length === 0) return;
    nsp.to(behind).emit(options.presenceEvent as never, options.encodePresence(occupants(roomId)) as never);
  }

  function presenceChanged(roomId: string, room: Room<TPresence>): void {
    room.version++;
    if (room.flush) return;
    room.flush = setTimeout(() => flushPresence(roomId), PRESENCE_SETTLE_MS);
    room.flush.unref?.();
  }

  const ctx: LiveRoomContext<TCaps, TPresence> = { nsp, roomName, occupants, emit, emitExcept };

  nsp.on('connection', (rawSocket) => {
    const socket = rawSocket as LiveSocket<TCaps>;
    const { user } = socket.data;

    function leave(): void {
      const roomId = socket.data.roomId;
      if (!roomId) return;

      options.onLeaving?.(socket, roomId);

      socket.data.roomId = undefined;
      socket.data.caps = undefined;
      socket.data.presenceVersion = undefined;
      void socket.leave(roomName(roomId));

      const room = rooms.get(roomId);
      const entry = room?.members.get(user.id);
      if (!room || !entry) return;

      // Presence is per USER across their tabs: they are present until the LAST
      // of their sockets goes. Closing one of two tabs changes nobody's list, so
      // it is not announced.
      entry.sockets.delete(socket.id);
      if (entry.sockets.size > 0) return;

      room.members.delete(user.id);
      if (room.members.size === 0) {
        if (room.flush) clearTimeout(room.flush);
        rooms.delete(roomId);
        options.onRoomEmpty?.(roomId);
        return;
      }
      presenceChanged(roomId, room);
    }

    socket.on(options.joinEvent, async (roomId: unknown, ack?: unknown) => {
      const reply = typeof ack === 'function' ? ack as (result: unknown) => void : undefined;
      if (typeof roomId !== 'string' || !roomId) {
        reply?.({ error: 'Invalid room id' });
        return;
      }

      let resolved: JoinResult<TCaps, TPresence> | null;
      try {
        resolved = await options.authorize(socket.data, roomId);
      } catch {
        reply?.({ error: 'Access check failed' });
        return;
      }
      // One answer for "denied" and "does not exist", so room ids are not
      // enumerable by anyone who can connect.
      if (!resolved) {
        reply?.({ error: 'Access denied' });
        return;
      }

      leave();   // a socket follows one room at a time

      socket.data.roomId = roomId;
      socket.data.caps = resolved.caps;
      await socket.join(roomName(roomId));

      let room = rooms.get(roomId);
      if (!room) {
        room = { members: new Map(), version: 0, flush: null };
        rooms.set(roomId, room);
      }
      const entry = room.members.get(user.id);
      if (entry) {
        entry.presence = resolved.presence;
        entry.sockets.add(socket.id);
      } else {
        room.members.set(user.id, { presence: resolved.presence, sockets: new Set([socket.id]) });
        presenceChanged(roomId, room);
      }

      // The joiner's list rides its ack, so the settled broadcast skips it unless
      // somebody else arrives or leaves in the meantime.
      socket.data.presenceVersion = room.version;
      const extra = options.onJoined?.(socket, roomId, resolved.caps) ?? {};
      reply?.({
        ok:       true,
        protocol: options.protocol,
        users:    options.encodePresence(occupants(roomId)),
        ...extra,
      });
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
