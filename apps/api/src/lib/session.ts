import { randomBytes } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { db, sessions } from '@starling/db';

export const SESSION_COOKIE  = 'syncsw_sid';
const        SESSION_TTL_MS  = 7 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_SEC = SESSION_TTL_MS / 1000;

/** The only data carried out of a session lookup — intentionally minimal. */
export interface SessionData {
  userId: number;
  role:   'admin' | 'user';
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

// Purge expired rows every 5 min. unref() so this timer doesn't keep the
// process alive during graceful shutdown.
setInterval(async () => {
  try {
    await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  } catch { /* non-fatal — will retry next interval */ }
}, 5 * 60_000).unref();

// ── Core operations ───────────────────────────────────────────────────────────

export async function createSession(userId: number, role: 'admin' | 'user'): Promise<string> {
  const id        = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id, userId, role, expiresAt });
  return id;
}

export async function getSession(id: string): Promise<SessionData | null> {
  const [row] = await db
    .select({ userId: sessions.userId, role: sessions.role, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1);

  if (!row) return null;

  if (row.expiresAt < new Date()) {
    // Expired — delete lazily (cleanup interval handles bulk; this handles precise expiry)
    await db.delete(sessions).where(eq(sessions.id, id)).catch(() => {});
    return null;
  }

  return { userId: row.userId, role: row.role };
}

export async function destroySession(id: string): Promise<void> {
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

/** Parse the Cookie header, look up the session, return data or null. */
export async function sessionFromCookies(
  cookieHeader: string | undefined,
): Promise<SessionData | null> {
  const id = parseSessionCookie(cookieHeader);
  return id ? getSession(id) : null;
}

/** Parse the Cookie header and destroy the referenced session. */
export async function destroySessionFromCookies(
  cookieHeader: string | undefined,
): Promise<void> {
  const id = parseSessionCookie(cookieHeader);
  if (id) await destroySession(id);
}
