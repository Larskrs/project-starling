import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, users } from '@starling/db';
import { defineEventHandler, readValidatedBody, ApiError } from '../../lib/handler.js';
import { hashPassword, verifyPassword } from '../../lib/auth.js';
import { createSession, sessionCookieHeader } from '../../lib/session.js';
import { createRateLimiter } from '../../lib/rateLimit.js';
import { getClientIp } from '../../lib/security.js';

const schema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

// Brute-force guard: 10 attempts per minute per IP+email pair.
const loginLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

// Verified against when the email doesn't exist, so both branches cost one
// scrypt — no timing oracle for user enumeration.
const DUMMY_HASH = await hashPassword('timing-equalizer-placeholder');

export default defineEventHandler(async (event) => {
  const { email, password } = await readValidatedBody(event, schema);

  if (!loginLimiter.check(`${getClientIp(event.req)}:${email.toLowerCase()}`)) {
    throw new ApiError(429, 'Too many login attempts — try again shortly', undefined, 'errors.generic.rateLimited');
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  const valid = await verifyPassword(password, user?.hashedPassword ?? DUMMY_HASH);
  if (!user || !valid) {
    throw new ApiError(401, 'Invalid email or password');
  }

  const sessionId = await createSession(user.id);
  event.res.setHeader('Set-Cookie', sessionCookieHeader(sessionId));

  return {
    user: {
      id:    user.id,
      email: user.email,
      name:  user.name,
      role:  user.role,
    },
  };
});
