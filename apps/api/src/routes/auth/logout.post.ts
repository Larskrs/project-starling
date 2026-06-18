import { db, sessions } from '@starling/db';
import { defineEventHandler } from '../../lib/handler.js';
import { destroySessionFromCookies, SESSION_COOKIE } from '../../lib/session.js';
import { eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  await destroySessionFromCookies(event.req.headers.cookie);
  event.res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`);
  await removeSession(SESSION_COOKIE);
  return { ok: true };
});


async function removeSession(sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}
