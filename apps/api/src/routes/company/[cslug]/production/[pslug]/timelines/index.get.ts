import { eq } from 'drizzle-orm';
import { db, timelines } from '@starling/db';
import { defineEventHandler } from '../../../../../../lib/handler.js';
import { requireProductionRoute } from '../../../../../../lib/production.js';

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionRoute(event);

  return db.select().from(timelines)
    .where(eq(timelines.productionId, production.id))
    .orderBy(timelines.createdAt);
});
