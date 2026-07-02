import { eq, and } from 'drizzle-orm';
import { db, trackTypes } from '@starling/db';
import { defineEventHandler, createError } from '../../../../../../lib/handler.js';
import { requireProductionRoute } from '../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

export default defineEventHandler(async (event) => {
  const { production, params } = await requireProductionRoute(event, {
    permission: Permission.MANAGE_TRACK_TYPES,
    params:     ['typeId'],
  });

  const [deleted] = await db.delete(trackTypes)
    .where(and(eq(trackTypes.id, params.typeId!), eq(trackTypes.productionId, production.id)))
    .returning();

  if (!deleted) throw createError({ statusCode: 404, message: 'Track type not found' });

  return { ok: true };
});
