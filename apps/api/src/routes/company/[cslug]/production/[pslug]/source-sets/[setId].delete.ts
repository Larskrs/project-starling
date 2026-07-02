import { eq, and } from 'drizzle-orm';
import { db, sourceSet } from '@starling/db';
import { defineEventHandler, createError } from '../../../../../../lib/handler.js';
import { requireProductionRoute } from '../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

export default defineEventHandler(async (event) => {
  const { production, params } = await requireProductionRoute(event, {
    permission: Permission.MANAGE_TRACK_TYPES,
    params:     ['setId'],
  });

  const [deleted] = await db.delete(sourceSet)
    .where(and(eq(sourceSet.id, params.setId!), eq(sourceSet.productionId, production.id)))
    .returning();

  if (!deleted) throw createError({ statusCode: 404, message: 'Source set not found' });

  return { ok: true };
});
