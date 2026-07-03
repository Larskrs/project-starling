import { defineEventHandler } from '../../lib/handler.js';
import { destroySessionFromCookies, clearSessionCookieHeader } from '../../lib/session.js';

export default defineEventHandler(async (event) => {
  await destroySessionFromCookies(event.req.headers.cookie);
  event.res.setHeader('Set-Cookie', clearSessionCookieHeader());
  return { ok: true };
});
