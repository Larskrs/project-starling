import { eq, and } from 'drizzle-orm';
import { db, timelines } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../../../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

export default defineEventHandler(async (event) => {
  const cslug = getRouterParam(event, 'cslug');
  const pslug = getRouterParam(event, 'pslug');
  const tlId  = getRouterParam(event, 'tlId');
  if (!cslug || !pslug || !tlId) throw createError({ statusCode: 400, message: 'Missing params' });

  const ctx = await requireProductionAccess(event, { cslug, pslug });
  await requirePermission(ctx, Permission.ADMINISTRATOR);

  const { production } = ctx;

  const [deleted] = await db.delete(timelines)
    .where(and(eq(timelines.id, tlId), eq(timelines.productionId, production.id)))
    .returning();

  if (!deleted) throw createError({ statusCode: 404, message: 'Timeline not found' });

  return { ok: true };
});
