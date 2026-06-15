import { defineEventHandler } from '../../lib/handler.js';
import { destroySessionFromCookies, SESSION_COOKIE } from '../../lib/session.js';

export default defineEventHandler(async (event) => {
  await destroySessionFromCookies(event.req.headers.cookie);
  event.res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`);
  return { ok: true };
});
