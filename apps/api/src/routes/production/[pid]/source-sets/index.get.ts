import { eq } from 'drizzle-orm';
import { db, sourceSet } from '@starling/db';
import { defineEventHandler } from '../../../../lib/http/handler.js';
import { requireProductionParam } from '../../../../lib/access/production.js';

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event);

  return db.select().from(sourceSet)
    .where(eq(sourceSet.productionId, production.id))
    .orderBy(sourceSet.createdAt);
});
