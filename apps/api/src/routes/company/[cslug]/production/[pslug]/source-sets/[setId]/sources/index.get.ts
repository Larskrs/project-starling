import { eq, and } from 'drizzle-orm';
import { db, sources, sourceSet } from '@starling/db';
import { defineEventHandler, createError } from '../../../../../../../../lib/handler.js';
import { requireProductionRoute } from '../../../../../../../../lib/production.js';

export default defineEventHandler(async (event) => {
  const { production, params } = await requireProductionRoute(event, { params: ['setId'] });
  const setId = params.setId!;

  // Verify the source set belongs to this production
  const [set] = await db.select().from(sourceSet)
    .where(and(eq(sourceSet.id, setId), eq(sourceSet.productionId, production.id)));
  if (!set) throw createError({ statusCode: 404, message: 'Source set not found' });

  return db.select().from(sources)
    .where(and(eq(sources.sourceSetId, setId), eq(sources.productionId, production.id)))
    .orderBy(sources.createdAt);
});
