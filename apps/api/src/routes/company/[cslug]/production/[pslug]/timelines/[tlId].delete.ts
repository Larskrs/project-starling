import { eq, and } from 'drizzle-orm';
import { db, timelines } from '@starling/db';
import { defineEventHandler, createError } from '../../../../../../lib/handler.js';
import { requireProductionRoute } from '../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

export default defineEventHandler(async (event) => {
  const { production, params } = await requireProductionRoute(event, {
    permission: Permission.MANAGE_TIMELINES,
    params:     ['tlId'],
  });

  const [deleted] = await db.delete(timelines)
    .where(and(eq(timelines.id, params.tlId!), eq(timelines.productionId, production.id)))
    .returning();

  if (!deleted) throw createError({ statusCode: 404, message: 'Timeline not found' });

  return { ok: true };
});
