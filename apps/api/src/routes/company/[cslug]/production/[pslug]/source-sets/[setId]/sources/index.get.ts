import { eq, and } from 'drizzle-orm';
import { db, sources, sourceSet } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../../../../../../lib/handler.js';
import { requireProductionAccess } from '../../../../../../../../lib/production.js';

export default defineEventHandler(async (event) => {
  const cslug = getRouterParam(event, 'cslug');
  const pslug = getRouterParam(event, 'pslug');
  const setId = getRouterParam(event, 'setId');
  if (!cslug || !pslug || !setId) throw createError({ statusCode: 400, message: 'Missing params' });

  const { production } = await requireProductionAccess(event, { cslug, pslug });

  // Verify the source set belongs to this production
  const [set] = await db.select().from(sourceSet)
    .where(and(eq(sourceSet.id, setId), eq(sourceSet.productionId, production.id)));
  if (!set) throw createError({ statusCode: 404, message: 'Source set not found' });

  return db.select().from(sources)
    .where(and(eq(sources.sourceSetId, setId), eq(sources.productionId, production.id)))
    .orderBy(sources.createdAt);
});
