import { eq } from 'drizzle-orm';
import { db, sourceSet } from '@starling/db';
import { defineEventHandler } from '../../../../../../lib/handler.js';
import { requireProductionRoute } from '../../../../../../lib/production.js';

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionRoute(event);

  return db.select().from(sourceSet)
    .where(eq(sourceSet.productionId, production.id))
    .orderBy(sourceSet.createdAt);
});
