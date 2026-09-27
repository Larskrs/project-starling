import { z } from 'zod';
import { db, users } from '@starling/db';
import { defineEventHandler, readValidatedBody, ApiError } from '../../lib/http/handler.js';
import { hashPassword, verifyPassword } from '../../lib/auth/password.js';
import { createSession, sessionCookieHeader } from '../../lib/auth/session.js';
import { createRateLimiter } from '../../lib/http/rateLimit.js';
import { getClientIp } from '../../lib/http/security.js';
import { toPublicUser, userEmailIs } from '../../lib/auth/user.js';
import { redeemForAuth } from '../../lib/access/invites.js';

const schema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
  /** One-time invite token, when they arrived from an invite link. */
  invite:   z.string().min(1).max(128).optional(),
});

// Brute-force guard: 10 attempts per minute per IP+email pair.
const loginLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

// Verified against when the email doesn't exist, so both branches cost one
// scrypt — no timing oracle for user enumeration.
const DUMMY_HASH = await hashPassword('timing-equalizer-placeholder');

export default defineEventHandler(async (event) => {
  const { email, password, invite } = await readValidatedBody(event, schema);

  if (!loginLimiter.check(`${getClientIp(event.req)}:${email.toLowerCase()}`)) {
    throw new ApiError(429, 'Too many login attempts — try again shortly', undefined, 'errors.generic.rateLimited');
  }

  const [user] = await db.select().from(users).where(userEmailIs(email)).limit(1);

  const valid = await verifyPassword(password, user?.hashedPassword ?? DUMMY_HASH);
  if (!user || !valid) {
    throw new ApiError(401, 'Invalid email or password');
  }

  const sessionId = await createSession(user.id);
  event.res.setHeader('Set-Cookie', sessionCookieHeader(sessionId));

  // Someone who already has an account and follows an invite link signs in
  // here; a failed invite still leaves them signed in, and the client says why.
  if (!invite) return { user: toPublicUser(user) };

  return { user: toPublicUser(user), invite: await redeemForAuth(invite, user) };
});
