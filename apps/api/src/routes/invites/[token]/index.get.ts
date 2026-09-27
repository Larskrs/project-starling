import { defineEventHandler, getRouterParam, getAuth, ApiError } from '../../../lib/http/handler.js';
import { createRateLimiter } from '../../../lib/http/rateLimit.js';
import { getClientIp } from '../../../lib/http/security.js';
import { lookupInvite } from '../../../lib/access/invites.js';

/**
 * What an invite grants, for the page a recipient lands on — deliberately
 * PUBLIC, because the whole point is that they have no account yet.
 *
 * Holding the token is the authorisation. It is 256 bits from a CSPRNG, so
 * there is nothing here to enumerate; what it discloses is a production name
 * and who invited them, which is exactly what the email already said.
 */
const previewLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });

export default defineEventHandler(async (event) => {
  if (!previewLimiter.check(getClientIp(event.req))) {
    throw new ApiError(429, 'Too many attempts — try again shortly', undefined, 'errors.generic.rateLimited');
  }

  const token = getRouterParam(event, 'token') ?? '';
  // Optional: a signed-in member re-opening a link they already used should be
  // shown the way in, not "this invitation was used up".
  const auth  = await getAuth(event);
  const found = await lookupInvite(token, auth?.userId || undefined);

  if (!found.ok) {
    // 404 for every rejection, with the reason in the key: the page needs to
    // say "this expired" rather than "something went wrong".
    throw new ApiError(404, `Invite ${found.reason}`, { reason: found.reason }, `errors.invite.${found.reason}`);
  }

  const { preview } = found;

  return {
    alreadyMember: found.alreadyMember,
    email:       preview.email,
    expiresAt:   preview.expiresAt,
    inviterName: preview.inviterName,
    roleName:    preview.roleName,
    // No image id: serving one needs auth, and the whole point of this page is
    // that the visitor has no session yet. The page draws a monogram instead,
    // the same fallback the email uses.
    production: { name: preview.production.name, slug: preview.production.slug },
    company: { name: preview.company.name, slug: preview.company.slug },
  };
});
