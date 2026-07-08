import { eq } from 'drizzle-orm';
import { db, productionRoles } from '@starling/db';
import { defineEventHandler } from '../../../../lib/handler.js';
import { requireProductionParam } from '../../../../lib/production.js';

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event);

  const roles = await db.select().from(productionRoles)
    .where(eq(productionRoles.productionId, production.id));

  return roles.map(r => ({ ...r, permissions: r.permissions.toString() }));
});
