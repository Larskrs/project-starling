import { eq } from 'drizzle-orm';
import { db, productionRoles } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../../../../lib/handler.js';
import { requireProductionAccess } from '../../../../../../lib/production.js';

export default defineEventHandler(async (event) => {
  const cslug = getRouterParam(event, 'cslug');
  const pslug = getRouterParam(event, 'pslug');
  if (!cslug || !pslug) throw createError({ statusCode: 400, message: 'Missing slugs' });

  const { production } = await requireProductionAccess(event, { cslug, pslug });

  const roles = await db.select().from(productionRoles)
    .where(eq(productionRoles.productionId, production.id));

  return roles.map(r => ({ ...r, permissions: r.permissions.toString() }));
});
