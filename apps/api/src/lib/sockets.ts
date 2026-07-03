import { Server as SocketIOServer, type Socket } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { eq } from 'drizzle-orm';
import { db, users } from '@starling/db';
import { sessionFromCookies } from './session.js';
import { setupTimelineSockets } from './timelineSockets.js';
import { isOriginAllowed } from './security.js';
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

export interface SocketData {
  user: SocketUser;
}

type AckResult  = { ok: true } | { error: string };
type Ack        = (result: AckResult) => void;
type ChatSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

// ── Shared auth middleware ────────────────────────────────────────────────────
// Resolves the session cookie to a user and stores it on socket.data.
// Used by the root (chat) namespace and the /timeline namespace.

export async function socketAuth(socket: Socket, next: (err?: Error) => void): Promise<void> {
  try {
    const session = await sessionFromCookies(socket.handshake.headers.cookie);
    if (!session) return next(new Error('Authentication required'));

    const [user] = await db
      .select({ id: users.id, name: users.name, avatarImageId: users.avatarImageId, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);

    if (!user) return next(new Error('User not found'));
    (socket.data as SocketData).user = { ...user, role: session.role };
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

function onlineUsers(): OnlineUser[] {
  return [...online.values()].map(e => e.user);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

export function setupSockets(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    path: '/socket',
    // Same origin policy as the HTTP server — a disallowed site can neither
    // read the handshake nor establish a credentialed connection.
    allowRequest: (req, callback) => {
      callback(null, isOriginAllowed(req.headers.origin, req.headers.host));
    },
    cors: {
      origin: (origin, callback) => {
        if (isOriginAllowed(origin ?? undefined, undefined)) callback(null, origin ?? true);
        else callback(new Error('Origin not allowed'));
      },
      credentials: true,
    },
  });

  io.use(socketAuth);
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
        .filter(a => a.type === 'gif' && typeof a.url === 'string')
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
