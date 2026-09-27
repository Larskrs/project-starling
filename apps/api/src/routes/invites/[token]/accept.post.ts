import { eq } from 'drizzle-orm';
import { db, users } from '@starling/db';
import { defineEventHandler, getRouterParam, requireAuth, ApiError } from '../../../lib/http/handler.js';
import { createRateLimiter } from '../../../lib/http/rateLimit.js';
import { getClientIp } from '../../../lib/http/security.js';
import { acceptInvite } from '../../../lib/access/invites.js';
import { productionPath } from '../../../lib/util/appPaths.js';

const acceptLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });

/**
 * Redeems an invite for the signed-in user.
 *
 * Sessions only — `requireAuth` refuses API tokens, and it should: a device
 * credential must never be able to enrol itself into another production.
 */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event);

  if (!acceptLimiter.check(getClientIp(event.req))) {
    throw new ApiError(429, 'Too many attempts — try again shortly', undefined, 'errors.generic.rateLimited');
  }

  const token = getRouterParam(event, 'token') ?? '';

  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, auth.userId))
    .limit(1);

  if (!user) throw new ApiError(401, 'Authentication required', undefined, 'errors.generic.authRequired');

  const result = await acceptInvite(token, user);

  if (!result.ok) {
    const status = result.reason === 'emailMismatch' ? 403 : 404;
    throw new ApiError(status, `Invite ${result.reason}`, { reason: result.reason }, `errors.invite.${result.reason}`);
  }

  const { preview, alreadyMember } = result;

  return {
    alreadyMember,
    production: { name: preview.production.name, slug: preview.production.slug },
    company:    { name: preview.company.name, slug: preview.company.slug },
    /** Where the client should land — the production it just joined. */
    path: productionPath(preview.company.slug, preview.production.slug),
  };
});
