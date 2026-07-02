import { eq, and } from 'drizzle-orm';
import { db, sources } from '@starling/db';
import { defineEventHandler, createError } from '../../../../../../../../lib/handler.js';
import { requireProductionRoute } from '../../../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

export default defineEventHandler(async (event) => {
  const { production, params } = await requireProductionRoute(event, {
    permission: Permission.MANAGE_TRACK_TYPES,
    params:     ['setId', 'sourceId'],
  });

  const [deleted] = await db.delete(sources)
    .where(and(
      eq(sources.id, params.sourceId!),
      eq(sources.sourceSetId, params.setId!),
      eq(sources.productionId, production.id),
    ))
    .returning();

  if (!deleted) throw createError({ statusCode: 404, message: 'Source not found' });

  return { ok: true };
});
