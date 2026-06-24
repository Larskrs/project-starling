import { eq } from 'drizzle-orm';
import { db, productionMembers, productionRoles, users } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../../../../lib/handler.js';
import { requireProductionAccess } from '../../../../../../lib/production.js';

export default defineEventHandler(async (event) => {
  const cslug = getRouterParam(event, 'cslug');
  const pslug = getRouterParam(event, 'pslug');
  if (!cslug || !pslug) throw createError({ statusCode: 400, message: 'Missing slugs' });

  const { production } = await requireProductionAccess(event, { cslug, pslug });

  const members = await db
    .select({
      id:        productionMembers.id,
      createdAt: productionMembers.createdAt,
      user: {
        id:        users.id,
        name:      users.name,
        firstName: users.first_name,
        lastName:  users.last_name,
        email:     users.email,
        avatar:    users.avatar,
      },
      role: {
        id:          productionRoles.id,
        name:        productionRoles.name,
        hue:         productionRoles.hue,
        permissions: productionRoles.permissions,
      },
    })
    .from(productionMembers)
    .innerJoin(users, eq(productionMembers.userId, users.id))
    .leftJoin(productionRoles, eq(productionMembers.roleId, productionRoles.id))
    .where(eq(productionMembers.productionId, production.id));

  return members.map(m => ({
    ...m,
    role: m.role?.id ? { ...m.role, permissions: m.role.permissions?.toString() } : null,
  }));
});
