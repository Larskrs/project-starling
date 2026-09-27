import { eq } from 'drizzle-orm';
import { db, trackTypes } from '@starling/db';
import { defineEventHandler } from '../../../../lib/http/handler.js';
import { requireProductionParam } from '../../../../lib/access/production.js';

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event);

  return db.select().from(trackTypes)
    .where(eq(trackTypes.productionId, production.id))
    .orderBy(trackTypes.sortOrder, trackTypes.createdAt);
});
