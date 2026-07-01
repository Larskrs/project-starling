import { eq, and } from 'drizzle-orm';
import { db, sources } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../../../../../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

export default defineEventHandler(async (event) => {
  const cslug    = getRouterParam(event, 'cslug');
  const pslug    = getRouterParam(event, 'pslug');
  const setId    = getRouterParam(event, 'setId');
  const sourceId = getRouterParam(event, 'sourceId');
  if (!cslug || !pslug || !setId || !sourceId) throw createError({ statusCode: 400, message: 'Missing params' });

  const ctx = await requireProductionAccess(event, { cslug, pslug });
  await requirePermission(ctx, Permission.ADMINISTRATOR);

  const { production } = ctx;

  const [deleted] = await db.delete(sources)
    .where(and(
      eq(sources.id, sourceId),
      eq(sources.sourceSetId, setId),
      eq(sources.productionId, production.id),
    ))
    .returning();

  if (!deleted) throw createError({ statusCode: 404, message: 'Source not found' });

  return { ok: true };
});
