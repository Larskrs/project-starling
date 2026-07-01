import { eq, and } from 'drizzle-orm';
import { db, sourceSet } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../../../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

export default defineEventHandler(async (event) => {
  const cslug = getRouterParam(event, 'cslug');
  const pslug = getRouterParam(event, 'pslug');
  const setId = getRouterParam(event, 'setId');
  if (!cslug || !pslug || !setId) throw createError({ statusCode: 400, message: 'Missing params' });

  const ctx = await requireProductionAccess(event, { cslug, pslug });
  await requirePermission(ctx, Permission.ADMINISTRATOR);

  const { production } = ctx;

  const [deleted] = await db.delete(sourceSet)
    .where(and(eq(sourceSet.id, setId), eq(sourceSet.productionId, production.id)))
    .returning();

  if (!deleted) throw createError({ statusCode: 404, message: 'Source set not found' });

  return { ok: true };
});
