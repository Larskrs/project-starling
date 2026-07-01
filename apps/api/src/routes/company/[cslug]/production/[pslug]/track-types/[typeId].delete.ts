import { eq, and } from 'drizzle-orm';
import { db, trackTypes } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../../../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

export default defineEventHandler(async (event) => {
  const cslug  = getRouterParam(event, 'cslug');
  const pslug  = getRouterParam(event, 'pslug');
  const typeId = getRouterParam(event, 'typeId');
  if (!cslug || !pslug || !typeId) throw createError({ statusCode: 400, message: 'Missing params' });

  const ctx = await requireProductionAccess(event, { cslug, pslug });
  await requirePermission(ctx, Permission.ADMINISTRATOR);

  const { production } = ctx;

  const [deleted] = await db.delete(trackTypes)
    .where(and(eq(trackTypes.id, typeId), eq(trackTypes.productionId, production.id)))
    .returning();

  if (!deleted) throw createError({ statusCode: 404, message: 'Track type not found' });

  return { ok: true };
});
