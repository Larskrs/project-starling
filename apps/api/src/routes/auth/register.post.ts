import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, users } from '@starling/db';
import { defineEventHandler, readValidatedBody, ApiError } from '../../lib/http/handler.js';
import { hashPassword } from '../../lib/auth/password.js';
import { createSession, sessionCookieHeader } from '../../lib/auth/session.js';
import { createRateLimiter } from '../../lib/http/rateLimit.js';
import { getClientIp } from '../../lib/http/security.js';
import { toPublicUser, normalizeEmail, userEmailIs } from '../../lib/auth/user.js';
import { redeemForAuth } from '../../lib/access/invites.js';

const schema = z.object({
  email:          z.string().email(),
  first_name:     z.string().min(1).max(50),
  last_name:      z.string().min(1).max(50),
  password:       z.string().min(8),
  /** One-time invite token, when they arrived from an invite link. */
  invite:         z.string().min(1).max(128).optional(),
});

// Registration abuse guard: 5 accounts per 10 minutes per IP.
const registerLimiter = createRateLimiter({ windowMs: 10 * 60_000, max: 5 });

export default defineEventHandler(async (event) => {
  const { email, first_name, last_name, password, invite } = await readValidatedBody(event, schema);

  if (!registerLimiter.check(getClientIp(event.req))) {
    throw new ApiError(429, 'Too many registrations — try again later', undefined, 'errors.generic.rateLimited');
  }

  // The unique index is case-sensitive, and accounts from before addresses were
  // normalised may be stored mixed-case — so "Bob@x.com" and "bob@x.com" are
  // caught here rather than becoming two accounts for one inbox.
  const [taken] = await db.select({ id: users.id }).from(users).where(userEmailIs(email)).limit(1);
  if (taken) throw new ApiError(409, 'Email already in use');

  const name = first_name + ' ' + last_name;
  const hashedPassword = await hashPassword(password);

  let user: typeof users.$inferSelect;
  try {
    [user] = await db.insert(users).values({
      email: normalizeEmail(email), name, hashedPassword, first_name, last_name,
    }).returning();
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
    if (code === '23505') throw new ApiError(409, 'Email already in use');
    throw err;
  }

  const sessionId = await createSession(user!.id);
  event.res.setHeader('Set-Cookie', sessionCookieHeader(sessionId));

  if (!invite) return { user: toPublicUser(user!) };

  const outcome = await redeemForAuth(invite, { id: user!.id, email: user!.email });

  // Arriving through a link mailed to this address, and registering with that
  // same address, is proof they read that inbox — which is all a verification
  // email would have established.
  if (outcome.accepted && outcome.emailBound) {
    await db.update(users).set({ isEmailVerified: true }).where(eq(users.id, user!.id));
    user!.isEmailVerified = true;
  }

  // A stale invite does not undo the account they just created; the client
  // reports why it did not apply.
  return { user: toPublicUser(user!), invite: outcome };
});
