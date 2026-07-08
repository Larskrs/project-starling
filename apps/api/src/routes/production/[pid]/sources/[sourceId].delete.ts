import { eq, and } from 'drizzle-orm';
import { db, sources } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../../lib/handler.js';
import { requireProductionParam } from '../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event, { permission: Permission.MANAGE_TRACK_TYPES });
  const sourceId = getRouterParam(event, 'sourceId')!;

  const [deleted] = await db.delete(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.productionId, production.id)))
    .returning();

  if (!deleted) throw createError({ statusCode: 404, message: 'Source not found' });

  return { ok: true };
});
