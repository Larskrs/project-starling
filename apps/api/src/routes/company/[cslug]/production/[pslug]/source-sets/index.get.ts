import { eq } from 'drizzle-orm';
import { db, sourceSet } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../../../../lib/handler.js';
import { requireProductionAccess } from '../../../../../../lib/production.js';

export default defineEventHandler(async (event) => {
  const cslug = getRouterParam(event, 'cslug');
  const pslug = getRouterParam(event, 'pslug');
  if (!cslug || !pslug) throw createError({ statusCode: 400, message: 'Missing slugs' });

  const { production } = await requireProductionAccess(event, { cslug, pslug });

  return db.select().from(sourceSet)
    .where(eq(sourceSet.productionId, production.id))
    .orderBy(sourceSet.createdAt);
});
