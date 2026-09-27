import { eq } from 'drizzle-orm';
import { db, timelines } from '@starling/db';
import { defineEventHandler } from '../../lib/http/handler.js';
import { requireProductionQuery } from '../../lib/access/production.js';

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionQuery(event);

  return db.select().from(timelines)
    .where(eq(timelines.productionId, production.id))
    .orderBy(timelines.createdAt);
});
