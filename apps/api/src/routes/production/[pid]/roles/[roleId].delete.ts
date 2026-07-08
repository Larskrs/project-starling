import { eq, and } from 'drizzle-orm';
import { db, productionRoles } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../../lib/handler.js';
import { requireProductionParam } from '../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event, { permission: Permission.MANAGE_ROLES });
  const roleId = getRouterParam(event, 'roleId')!;

  const [deleted] = await db.delete(productionRoles)
    .where(and(eq(productionRoles.id, roleId), eq(productionRoles.productionId, production.id)))
    .returning();

  if (!deleted) throw createError({ statusCode: 404, message: 'Role not found' });

  return { ok: true };
});
