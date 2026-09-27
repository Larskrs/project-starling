import { eq } from 'drizzle-orm';
import { db, users } from '@starling/db';
import { defineEventHandler, requireAuth, ApiError } from '../../lib/http/handler.js';
import { createRateLimiter } from '../../lib/http/rateLimit.js';
import { appUrl } from '../../lib/email/mailer.js';
import { sendEmailVerification } from '../../lib/email/notify.js';
import { issueVerification, verificationUrlPath, VERIFICATION_TTL_HOURS } from '../../lib/email/verification.js';

// Each send is an email to a real inbox, and the address is chosen by the
// account holder — so the ceiling is per user, not per IP.
const sendLimiter = createRateLimiter({ windowMs: 60 * 60_000, max: 5 });

/**
 * Sends the signed-in user a link confirming their own address.
 *
 * Deliberately only ever mails the address ON the account: a route that took an
 * address from the request body would be an open relay for whoever is signed
 * in, and would prove nothing about the account either.
 */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event);

  const [user] = await db
    .select({ id: users.id, email: users.email, isEmailVerified: users.isEmailVerified })
    .from(users)
    .where(eq(users.id, auth.userId))
    .limit(1);

  if (!user) throw new ApiError(404, 'User not found');

  // Not an error: the button may simply have been clicked twice.
  if (user.isEmailVerified) return { sent: false, alreadyVerified: true, email: user.email };

  if (!sendLimiter.check(user.id)) {
    throw new ApiError(429, 'Too many verification emails — try again later', undefined, 'errors.generic.rateLimited');
  }

  const token = await issueVerification(user);

  await sendEmailVerification({
    to:             user.email,
    url:            appUrl(verificationUrlPath(token)),
    expiresInHours: VERIFICATION_TTL_HOURS,
  });

  return { sent: true, alreadyVerified: false, email: user.email, expiresInHours: VERIFICATION_TTL_HOURS };
});
