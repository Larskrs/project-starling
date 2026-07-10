import { randomBytes } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { db, sessions, users } from '@starling/db';
import { TtlCache } from './cache.js';

export const SESSION_COOKIE  = 'syncsw_sid';
const        SESSION_TTL_MS  = 24 * 60 * 60 * 1000;
export const SESSION_TTL_SEC = SESSION_TTL_MS / 1000;

export interface SessionData {
  userId: string;
  role:   'admin' | 'user';
}

// Short-lived read cache: every REST request and socket handshake resolves the
// session, so this saves a DB round-trip per request. 30s staleness is capped
// far below the 24h TTL, and destroySession invalidates immediately.
const sessionCache = new TtlCache<string, SessionData>(30_000, 5000);

// ── Cookie builders (single source of truth for attributes) ──────────────────

// In production the session is shared across the Plesk split — cino.no apex,
// app.cino.no, api.cino.no — so the cookie is scoped to the registrable domain
// (Domain=cino.no covers the apex and every subdomain). COOKIE_DOMAIN overrides
// for other deployments; dev (localhost) stays host-only, which browsers require.
const cookieDomain = process.env.COOKIE_DOMAIN
  ?? (process.env.NODE_ENV === 'production' ? 'cino.no' : '');

const cookieAttrs = () =>
  'HttpOnly; SameSite=Lax; Path=/'
  + (process.env.NODE_ENV === 'production' ? '; Secure' : '')
  + (cookieDomain ? `; Domain=${cookieDomain}` : '');

export function sessionCookieHeader(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; Max-Age=${SESSION_TTL_SEC}; ${cookieAttrs()}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Max-Age=0; ${cookieAttrs()}`;
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

setInterval(async () => {
  try {
    await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  } catch { /* non-fatal — will retry next interval */ }
}, 5 * 60_000).unref();

// ── Core operations ───────────────────────────────────────────────────────────

export async function createSession(userId: string): Promise<string> {
  const id        = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id, userId, expiresAt });
  return id;
}

export async function getSession(id: string): Promise<SessionData | null> {
  const cached = sessionCache.get(id);
  if (cached) return cached;

  const [row] = await db
    .select({
      userId:    sessions.userId,
      role:      users.role,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .limit(1);

  if (!row) return null;

  if (row.expiresAt < new Date()) {
    await db.delete(sessions).where(eq(sessions.id, id)).catch(() => {});
    return null;
  }

  const data: SessionData = { userId: row.userId, role: row.role };
  sessionCache.set(id, data);
  return data;
}

export async function destroySession(id: string): Promise<void> {
  sessionCache.delete(id);
  await db.delete(sessions).where(eq(sessions.id, id));
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

export function parseSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export async function sessionFromCookies(
  cookieHeader: string | undefined,
): Promise<SessionData | null> {
  const id = parseSessionCookie(cookieHeader);
  return id ? getSession(id) : null;
}

export async function destroySessionFromCookies(
  cookieHeader: string | undefined,
): Promise<void> {
  const id = parseSessionCookie(cookieHeader);
  if (id) await destroySession(id);
}
