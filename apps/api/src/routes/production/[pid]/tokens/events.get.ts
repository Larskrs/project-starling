import z from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { db, apiTokenEvents, apiTokens, users } from '@starling/db';
import { defineEventHandler, getValidatedQuery } from '../../../../lib/handler.js';
import { requireProductionParam } from '../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const querySchema = z.object({
  tokenId: z.uuid().optional(),
  limit:   z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * The production's token audit trail, newest first.
 *
 * Rejections are included deliberately: a burst of them against one address is
 * the most useful thing this log can show you, and hiding failures would make
 * it a record of successes rather than an audit.
 */
export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event, { permission: Permission.ADMINISTRATOR });
  const { tokenId, limit } = getValidatedQuery(event, querySchema);

  const where = tokenId
    ? and(eq(apiTokenEvents.productionId, production.id), eq(apiTokenEvents.tokenId, tokenId))
    : eq(apiTokenEvents.productionId, production.id);

  const rows = await db
    .select({
      id:         apiTokenEvents.id,
      tokenId:    apiTokenEvents.tokenId,
      // Joined so a revoked token's history still reads as a name rather than
      // a uuid nobody recognises.
      tokenLabel: apiTokens.label,
      event:      apiTokenEvents.event,
      entityType: apiTokenEvents.entityType,
      ip:         apiTokenEvents.ip,
      detail:     apiTokenEvents.detail,
      actorName:  users.name,
      occurredAt: apiTokenEvents.occurredAt,
    })
    .from(apiTokenEvents)
    .leftJoin(apiTokens, eq(apiTokenEvents.tokenId, apiTokens.id))
    .leftJoin(users, eq(apiTokenEvents.actorUserId, users.id))
    .where(where)
    .orderBy(desc(apiTokenEvents.occurredAt))
    .limit(limit);

  return { events: rows };
});
