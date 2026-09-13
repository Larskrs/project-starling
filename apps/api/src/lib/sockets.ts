import { Server as SocketIOServer, type Socket } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { eq } from 'drizzle-orm';
import { db, users } from '@starling/db';
import { TOKEN_PRESENCE_PREFIX } from '@starling/realtime';
import { sessionFromCookies } from './session.js';
import { verifyApiToken, recordTokenEvent } from './apiTokens.js';
import { setupTimelineSockets } from './timelineSockets.js';
import { isOriginAllowed, requestHost } from './security.js';
import { createRateLimiter } from './rateLimit.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Attachment {
  type: 'gif';
  url:  string;
}

export interface ChatMessage {
  id:          string;
  text:        string;
  attachments: Attachment[];
  user:        { id: string; name: string };
  sentAt:      string;
}

export interface SocketUser {
  id:            string;
  name:          string;
  avatarImageId: string | null;
  createdAt:     Date;
  role:          'admin' | 'user';
}

type OnlineUser = Pick<SocketUser, 'id' | 'name'>;

interface ServerToClientEvents {
  'message:new': (message: ChatMessage) => void;
  'user:joined': (user: OnlineUser) => void;
  'user:left':   (user: OnlineUser) => void;
  'history':     (messages: ChatMessage[]) => void;
  'online':      (users: OnlineUser[]) => void;
}

interface MessagePayload {
  text:        string;
  attachments?: Attachment[];
}

interface ClientToServerEvents {
  'message:send': (payload: MessagePayload, ack?: Ack) => void;
}

/**
 * Who a socket belongs to, in the form the access check needs.
 *
 * Kept beside `user` rather than folded into it because `user` is the PRESENCE
 * identity — what the room displays — and those are genuinely different things
 * for a machine. A desk shows as "FOH Lighting Desk"; its access comes from the
 * token's production and masked role.
 */
export type SocketPrincipal =
  | { kind: 'user';  userId: string; role: 'admin' | 'user' }
  | { kind: 'token'; tokenId: string; productionId: string; permissions: bigint };

export interface SocketData {
  user: SocketUser;
  principal: SocketPrincipal;
}

type AckResult  = { ok: true } | { error: string };
type Ack        = (result: AckResult) => void;
type ChatSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

// ── Shared auth middleware ────────────────────────────────────────────────────
// Resolves the session cookie to a user and stores it on socket.data.
// Used by the root (chat) namespace and the /timeline namespace.

// A token's presence id is `TOKEN_PRESENCE_PREFIX` + its id — declared in
// @starling/realtime, because clients use it to list devices apart from people.

export async function socketAuth(socket: Socket, next: (err?: Error) => void): Promise<void> {
  try {
    // The token rides the handshake `auth` payload rather than a header:
    // browsers cannot set headers on a WebSocket upgrade, so one form means one
    // code path. Checked first for the same reason bearer beats cookie on REST.
    const raw = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    if (typeof raw === 'string' && raw.length > 0) {
      const result = await verifyApiToken(raw);
      if (!result.ok) {
        recordTokenEvent({
          event:  'rejected',
          ip:     socket.handshake.address,
          detail: `${result.reason} on socket handshake`,
        });
        // The message is the errorKey, so a device can tell a dead credential
        // from a transient failure and stop retrying.
        return next(new Error(`errors.auth.${result.reason}`));
      }

      const p = result.principal;
      (socket.data as SocketData).user = {
        id:            `${TOKEN_PRESENCE_PREFIX}${p.tokenId}`,
        name:          p.label,
        avatarImageId: p.profileImageId,
        createdAt:     new Date(),
        // Pinned to 'user': can() short-circuits on 'admin', and a token must
        // never inherit the global role of whoever issued it.
        role:          'user',
      };
      (socket.data as SocketData).principal = {
        kind: 'token', tokenId: p.tokenId, productionId: p.productionId, permissions: p.permissions,
      };
      return next();
    }

    const session = await sessionFromCookies(socket.handshake.headers.cookie);
    if (!session) return next(new Error('Authentication required'));

    const [user] = await db
      .select({ id: users.id, name: users.name, avatarImageId: users.avatarImageId, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!user) return next(new Error('User not found'));
    (socket.data as SocketData).user = { ...user, role: session.role };
    (socket.data as SocketData).principal = { kind: 'user', userId: user.id, role: session.role };
    next();
  } catch {
    next(new Error('Authentication failed'));
  }
}

// ── In-memory state ───────────────────────────────────────────────────────────

const MAX_HISTORY = 100;
const history: ChatMessage[] = [];
const online  = new Map<string, { user: OnlineUser; sockets: Set<string> }>(); // userId → {user, socketIds}

// Per-user chat flood guard: 8 messages per 10 seconds.
const chatLimiter = createRateLimiter({ windowMs: 10_000, max: 8 });

// Attachments must point at the GIF provider our proxy serves (see
// /chat/gifs/*) — without this, any client could broadcast arbitrary
// third-party URLs (tracking pixels, oversized media) to every connected user.
function isAllowedAttachmentUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'giphy.com' || u.hostname.endsWith('.giphy.com'));
  } catch {
    return false;
  }
}

function onlineUsers(): OnlineUser[] {
  return [...online.values()].map(e => e.user);
}

// ── Token revocation ──────────────────────────────────────────────────────────

let ioServer: SocketIOServer | null = null;

/**
 * Closes every live socket holding a given token, across all namespaces.
 *
 * Capabilities are resolved once at join and cached on the socket, so without
 * this a revoked token would keep its access until the revalidation sweep came
 * round. The sweep is the backstop — it also catches role changes, and it is
 * what still works when a second API instance holds the socket. This is the
 * fast path for the common case of one process.
 *
 * The documented guarantee stays 60 seconds regardless, because that is the one
 * that survives running more than one instance.
 */
export function disconnectTokenSockets(tokenId: string): void {
  if (!ioServer) return;

  // `_nsps` is socket.io's own namespace map. Underscored but typed, and the
  // only way to sweep EVERY namespace — naming them individually here would
  // silently miss the next one somebody adds, which is the failure mode this
  // function exists to prevent.
  for (const nsp of ioServer._nsps.values()) {
    for (const socket of nsp.sockets.values()) {
      const principal = (socket.data as SocketData).principal;
      if (principal?.kind !== 'token' || principal.tokenId !== tokenId) continue;
      socket.emit('access:revoked', { reason: 'errors.auth.tokenInvalid' });
      socket.disconnect(true);
    }
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

export function setupSockets(httpServer: HttpServer): SocketIOServer {

  console.log('[server] Setting up Socket.IO server');
  
  const io = new SocketIOServer(httpServer, {
    path: '/socket',
    // Same origin policy as the HTTP server, evaluated in allowRequest where the
    // full request is available: forwarded host honoured (Plesk/nginx rewrite the
    // Host header), and a MISSING Origin is allowed — same-origin pages, native
    // clients, and reverse proxies that strip the header all arrive without one.
    // The previous cors-callback approach broke on Plesk because it had neither
    // the request host nor a way to treat absent origins as same-origin.
    allowRequest: (req, callback) => {
      callback(null, isOriginAllowed(req.headers.origin, requestHost(req)));
    },
    // Headers only — reflects the origin allowRequest already vetted, so
    // browsers accept cross-subdomain polling responses (app.cino.no → cino.no).
    cors: { origin: true, credentials: true },
  });

  ioServer = io;

  io.use(socketAuth);

  // The root namespace is global chat between people — not scoped to any
  // production, so a token has no business in it. Machine access is allowed
  // only where a production bounds it, which is the /timeline namespace.
  io.use((socket, next) => {
    const { principal } = socket.data as SocketData;
    if (principal?.kind === 'token') return next(new Error('errors.auth.tokenNotPermitted'));
    next();
  });

  setupTimelineSockets(io);

  // ── Connection ───────────────────────────────────────────────────────────
  io.on('connection', (rawSocket) => {
    const socket = rawSocket as ChatSocket;
    // Chat payloads only carry the public identity, not the session role.
    const user: OnlineUser = { id: socket.data.user.id, name: socket.data.user.name };

    const isFirstSocket = !online.has(user.id);
    if (isFirstSocket) {
      online.set(user.id, { user, sockets: new Set() });
    }
    online.get(user.id)!.sockets.add(socket.id);

    socket.emit('history', history);
    socket.emit('online', onlineUsers());
    if (isFirstSocket) socket.broadcast.emit('user:joined', user);

    // ── message:send ─────────────────────────────────────────────────────
    socket.on('message:send', ({ text, attachments = [] }, ack) => {
      if (typeof text !== 'string' || !text.trim()) {
        ack?.({ error: 'Empty message' });
        return;
      }

      if (!chatLimiter.check(user.id)) {
        ack?.({ error: 'Too many messages — slow down' });
        return;
      }

      const safeAttachments: Attachment[] = attachments
        .filter(a => a.type === 'gif' && typeof a.url === 'string' && isAllowedAttachmentUrl(a.url))
        .slice(0, 10);

      const message: ChatMessage = {
        id:          crypto.randomUUID(),
        text:        text.trim().slice(0, 2000),
        attachments: safeAttachments,
        user,
        sentAt:      new Date().toISOString(),
      };

      history.push(message);
      if (history.length > MAX_HISTORY) history.shift();

      io.emit('message:new', message);
      ack?.({ ok: true });
    });

    // ── Disconnect ───────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const entry = online.get(user.id);
      if (!entry) return;
      entry.sockets.delete(socket.id);
      if (entry.sockets.size === 0) {
        online.delete(user.id);
        io.emit('user:left', user);
      }
    });
  });

  return io;
}
