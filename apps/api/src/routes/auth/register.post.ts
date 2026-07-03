import { z } from 'zod';
import { db, users } from '@starling/db';
import { defineEventHandler, readValidatedBody, ApiError } from '../../lib/handler.js';
import { hashPassword } from '../../lib/auth.js';
import { createSession, sessionCookieHeader } from '../../lib/session.js';
import { createRateLimiter } from '../../lib/rateLimit.js';
import { getClientIp } from '../../lib/security.js';

const schema = z.object({
  email:          z.string().email(),
  first_name:     z.string().min(1).max(50),
  last_name:      z.string().min(1).max(50),
  password:       z.string().min(8),
});

// Registration abuse guard: 5 accounts per 10 minutes per IP.
const registerLimiter = createRateLimiter({ windowMs: 10 * 60_000, max: 5 });

export default defineEventHandler(async (event) => {
  const { email, first_name, last_name, password } = await readValidatedBody(event, schema);

  if (!registerLimiter.check(getClientIp(event.req))) {
    throw new ApiError(429, 'Too many registrations — try again later', undefined, 'errors.generic.rateLimited');
  }

  const name = first_name + ' ' + last_name;
  const hashedPassword = await hashPassword(password);

  let user: typeof users.$inferSelect;
  try {
    [user] = await db.insert(users).values({ email, name, hashedPassword, first_name, last_name }).returning();
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
    if (code === '23505') throw new ApiError(409, 'Email already in use');
    throw err;
  }

  const sessionId = await createSession(user!.id);
  event.res.setHeader('Set-Cookie', sessionCookieHeader(sessionId));

  return {
    user: {
      id:         user!.id,
      email:      user!.email,
      name:       user!.name,
      first_name: user!.first_name,
      last_name:  user!.last_name,
      role:       user!.role,
    },
  };
});
