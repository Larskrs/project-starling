import { defineEventHandler, getRouterParam, ApiError } from '../../lib/http/handler.js';
import { createRateLimiter } from '../../lib/http/rateLimit.js';
import { getClientIp } from '../../lib/http/security.js';
import { verifyEmailToken } from '../../lib/email/verification.js';

const confirmLimiter = createRateLimiter({ windowMs: 60_000, max: 30 });

/**
 * Confirms an address from the emailed link.
 *
 * No session required, on purpose: people open mail on the phone and work in
 * the browser, and a link that only works where you are already signed in is a
 * link that fails half the time. The token is the proof.
 */
export default defineEventHandler(async (event) => {
  if (!confirmLimiter.check(getClientIp(event.req))) {
    throw new ApiError(429, 'Too many attempts — try again shortly', undefined, 'errors.generic.rateLimited');
  }

  const token  = getRouterParam(event, 'token') ?? '';
  const result = await verifyEmailToken(token);

  if (!result.ok) {
    throw new ApiError(404, `Verification ${result.reason}`, { reason: result.reason }, `errors.verifyEmail.${result.reason}`);
  }

  return { verified: true, email: result.email, alreadyVerified: result.alreadyVerified };
});
