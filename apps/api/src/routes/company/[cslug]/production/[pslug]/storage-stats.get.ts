import { eq, sql } from 'drizzle-orm';
import { db, storageFiles } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../../../lib/handler.js';
import { requireProductionAccess } from '../../../../../lib/production.js';

export default defineEventHandler(async (event) => {
  const cslug = getRouterParam(event, 'cslug');
  const pslug = getRouterParam(event, 'pslug');
  if (!cslug || !pslug) throw createError({ statusCode: 400, message: 'Missing slugs' });

  const { production } = await requireProductionAccess(event, { cslug, pslug });

  const breakdown = await db
    .select({
      type: storageFiles.type,
      size: sql<number>`coalesce(sum(${storageFiles.size}), 0)`,
    })
    .from(storageFiles)
    .where(eq(storageFiles.productionId, production.id))
    .groupBy(storageFiles.type);

  const usedStorage = breakdown.reduce((sum, r) => sum + Number(r.size), 0);

  return {
    usedStorage,
    allocatedStorage: production.allocatedStorage,
    breakdown: breakdown.map(r => ({ type: r.type, size: Number(r.size) })),
  };
});
