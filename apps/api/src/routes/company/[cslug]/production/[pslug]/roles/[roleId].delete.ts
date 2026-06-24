import { eq, and } from 'drizzle-orm';
import { db, productionRoles } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../../../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

export default defineEventHandler(async (event) => {
  const cslug  = getRouterParam(event, 'cslug');
  const pslug  = getRouterParam(event, 'pslug');
  const roleId = getRouterParam(event, 'roleId');
  if (!cslug || !pslug || !roleId) throw createError({ statusCode: 400, message: 'Missing params' });

  const ctx = await requireProductionAccess(event, { cslug, pslug });
  await requirePermission(ctx, Permission.MANAGE_ROLES);

  const { production } = ctx;

  const [deleted] = await db.delete(productionRoles)
    .where(and(eq(productionRoles.id, roleId), eq(productionRoles.productionId, production.id)))
    .returning();

  if (!deleted) throw createError({ statusCode: 404, message: 'Role not found' });

  return { ok: true };
});
