import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, sources, sourceSet } from '@starling/db';
import { defineEventHandler, getValidatedQuery, createError } from '../../../../lib/handler.js';
import { requireProductionParam } from '../../../../lib/production.js';

const querySchema = z.object({
  sid: z.uuid(),
});

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event);
  const { sid } = getValidatedQuery(event, querySchema);

  // Verify the source set belongs to this production.
  const [set] = await db.select({ id: sourceSet.id }).from(sourceSet)
    .where(and(eq(sourceSet.id, sid), eq(sourceSet.productionId, production.id)))
    .limit(1);
  if (!set) throw createError({ statusCode: 404, message: 'Source set not found' });

  return db.select().from(sources)
    .where(and(eq(sources.sourceSetId, sid), eq(sources.productionId, production.id)))
    .orderBy(sources.createdAt);
});
