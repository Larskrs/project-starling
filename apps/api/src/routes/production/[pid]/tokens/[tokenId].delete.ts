import { eq, and, isNull } from 'drizzle-orm';
import { db, apiTokens } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../../lib/handler.js';
import { requireProductionParam } from '../../../../lib/production.js';
import { getClientIp } from '../../../../lib/security.js';
import { invalidateToken, recordTokenEvent } from '../../../../lib/apiTokens.js';
import { disconnectTokenSockets } from '../../../../lib/sockets.js';
import { Permission } from '@starling/auth/permissions';

/**
 * Revokes a token.
 *
 * The row is marked, not deleted: the audit log points at it, and history that
 * loses its subject is worth much less. `revokedAt` is what every later check
 * reads, so the row lingering changes nothing about access.
 *
 * Three things have to happen, and skipping any one of them leaves a revoked
 * credential working somewhere:
 *   1. the row is marked, so a cold lookup refuses it
 *   2. the in-process cache entry is dropped, so a warm one refuses it too
 *   3. live sockets holding it are closed, because capabilities were cached at
 *      join and would otherwise outlive the credential indefinitely
 */
export default defineEventHandler(async (event) => {
  const ctx = await requireProductionParam(event, { permission: Permission.ADMINISTRATOR });
  const tokenId = getRouterParam(event, 'tokenId')!;

  // Scoped by production as well as id, so an administrator of one production
  // cannot revoke another's token by guessing a uuid.
  const [token] = await db.select().from(apiTokens)
    .where(and(
      eq(apiTokens.id, tokenId),
      eq(apiTokens.productionId, ctx.production.id),
      isNull(apiTokens.revokedAt),
    ))
    .limit(1);
  if (!token) throw createError({ statusCode: 404, message: 'Token not found', errorKey: 'errors.token.notFound' });

  await db.update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(eq(apiTokens.id, tokenId));

  invalidateToken(tokenId);
  disconnectTokenSockets(tokenId);

  recordTokenEvent({
    tokenId,
    productionId: ctx.production.id,
    event:        'revoked',
    actorUserId:  ctx.auth.userId || null,
    ip:           getClientIp(event.req),
    detail:       `revoked "${token.label}"`,
  });

  return { ok: true };
});
