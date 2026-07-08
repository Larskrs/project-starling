import { eq, and } from 'drizzle-orm';
import { db, trackTypes } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../../lib/handler.js';
import { requireProductionParam } from '../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event, { permission: Permission.MANAGE_TRACK_TYPES });
  const typeId = getRouterParam(event, 'typeId')!;

  const [deleted] = await db.delete(trackTypes)
    .where(and(eq(trackTypes.id, typeId), eq(trackTypes.productionId, production.id)))
    .returning();

  if (!deleted) throw createError({ statusCode: 404, message: 'Track type not found' });

  return { ok: true };
});
