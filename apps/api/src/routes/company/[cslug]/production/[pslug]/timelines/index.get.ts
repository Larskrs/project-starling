import { eq } from 'drizzle-orm';
import { db, timelines } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../../../../lib/handler.js';
import { requireProductionAccess } from '../../../../../../lib/production.js';

export default defineEventHandler(async (event) => {
  const cslug = getRouterParam(event, 'cslug');
  const pslug = getRouterParam(event, 'pslug');
  if (!cslug || !pslug) throw createError({ statusCode: 400, message: 'Missing slugs' });

  const { production } = await requireProductionAccess(event, { cslug, pslug });

  return db.select().from(timelines)
    .where(eq(timelines.productionId, production.id))
    .orderBy(timelines.createdAt);
});
