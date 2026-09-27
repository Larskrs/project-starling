import { defineEventHandler } from '../../lib/http/handler.js';
import { destroySessionFromCookies, clearSessionCookieHeader } from '../../lib/auth/session.js';

export default defineEventHandler(async (event) => {
  await destroySessionFromCookies(event.req.headers.cookie);
  event.res.setHeader('Set-Cookie', clearSessionCookieHeader());
  return { ok: true };
});
