import { eq } from 'drizzle-orm';
import { db, trackTypes } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../../../../lib/handler.js';
import { requireProductionAccess } from '../../../../../../lib/production.js';

export default defineEventHandler(async (event) => {
  const cslug = getRouterParam(event, 'cslug');
  const pslug = getRouterParam(event, 'pslug');
  if (!cslug || !pslug) throw createError({ statusCode: 400, message: 'Missing slugs' });

  const { production } = await requireProductionAccess(event, { cslug, pslug });

  return db.select().from(trackTypes)
    .where(eq(trackTypes.productionId, production.id))
    .orderBy(trackTypes.sortOrder, trackTypes.createdAt);
});
