import { eq, sql } from 'drizzle-orm';
import { db, storageFiles } from '@starling/db';
import { defineEventHandler } from '../../../lib/handler.js';
import { requireProductionParam } from '../../../lib/production.js';

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event);

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
