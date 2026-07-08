import { eq, and } from 'drizzle-orm';
import { db, sourceSet } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../../lib/handler.js';
import { requireProductionParam } from '../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event, { permission: Permission.MANAGE_TRACK_TYPES });
  const setId = getRouterParam(event, 'setId')!;

  const [deleted] = await db.delete(sourceSet)
    .where(and(eq(sourceSet.id, setId), eq(sourceSet.productionId, production.id)))
    .returning();

  if (!deleted) throw createError({ statusCode: 404, message: 'Source set not found' });

  return { ok: true };
});
