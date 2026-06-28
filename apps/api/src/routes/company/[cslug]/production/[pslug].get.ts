import { eq } from 'drizzle-orm';
import { db, productionRoles } from '@starling/db';
import { decode } from '@starling/auth/permissions';
import { defineEventHandler, getRouterParam, createError } from '../../../../lib/handler.js';
import { requireProductionAccess } from '../../../../lib/production.js';

export default defineEventHandler(async (event) => {
  const cslug = getRouterParam(event, 'cslug');
  const pslug = getRouterParam(event, 'pslug');
  if (!cslug || !pslug) throw createError({ statusCode: 400, message: 'Missing slugs' });

  const { company, production, privileged, memberRoleId } = await requireProductionAccess(event, { cslug, pslug });

  let permissions: string[] = [];
  if (!privileged && memberRoleId) {
    const [role] = await db
      .select({ permissions: productionRoles.permissions })
      .from(productionRoles)
      .where(eq(productionRoles.id, memberRoleId))
      .limit(1);
    if (role?.permissions) permissions = decode(role.permissions);
  }

  return { company, production, access: { privileged, permissions } };
});
