import { Server as SocketIOServer, type Socket } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { eq } from 'drizzle-orm';
import { db, users } from '@starling/db';
import { sessionFromCookies } from './session.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id:     string;
  text:   string;
  user:   { id: string; name: string };
  sentAt: string;
}

interface OnlineUser {
  id:   string;
  name: string;
}

interface ServerToClientEvents {
  'message:new': (message: ChatMessage) => void;
  'user:joined': (user: OnlineUser) => void;
  'user:left':   (user: OnlineUser) => void;
  'history':     (messages: ChatMessage[]) => void;
  'online':      (users: OnlineUser[]) => void;
}

interface ClientToServerEvents {
  'message:send': (text: string, ack?: Ack) => void;
}

interface SocketData {
  user: OnlineUser;
}

type AckResult  = { ok: true } | { error: string };
type Ack        = (result: AckResult) => void;
type ChatSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

// ── In-memory state ───────────────────────────────────────────────────────────

const MAX_HISTORY = 100;
const history: ChatMessage[] = [];
const online  = new Map<string, { user: OnlineUser; sockets: Set<string> }>(); // userId → {user, socketIds}

function onlineUsers(): OnlineUser[] {
  return [...online.values()].map(e => e.user);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

export function setupSockets(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    path: '/socket',
    cors: { origin: true, credentials: true },
  });

  // ── Auth middleware ──────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const session = await sessionFromCookies(socket.handshake.headers.cookie);
      if (!session) return next(new Error('Authentication required'));

      const [user] = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1);

      if (!user) return next(new Error('User not found'));
      (socket as ChatSocket).data.user = user;
      next();
    } catch {
      next(new Error('Authentication failed'));
    }
  });

  // ── Connection ───────────────────────────────────────────────────────────
  io.on('connection', (rawSocket) => {
    const socket = rawSocket as ChatSocket;
    const { user } = socket.data;

    const isFirstSocket = !online.has(user.id);
    if (isFirstSocket) {
      online.set(user.id, { user, sockets: new Set() });
    }
    online.get(user.id)!.sockets.add(socket.id);

    socket.emit('history', history);
    socket.emit('online', onlineUsers());
    if (isFirstSocket) socket.broadcast.emit('user:joined', user);

    // ── message:send ─────────────────────────────────────────────────────
    socket.on('message:send', (text, ack) => {
      if (typeof text !== 'string' || !text.trim()) {
        ack?.({ error: 'Empty message' });
        return;
      }

      const message: ChatMessage = {
        id:     crypto.randomUUID(),
        text:   text.trim().slice(0, 2000),
        user,
        sentAt: new Date().toISOString(),
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
