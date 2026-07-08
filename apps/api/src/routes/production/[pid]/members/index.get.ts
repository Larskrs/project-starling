import { eq } from 'drizzle-orm';
import { db, productionMembers, productionRoles, users } from '@starling/db';
import { defineEventHandler } from '../../../../lib/handler.js';
import { requireProductionParam } from '../../../../lib/production.js';

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event);

  const members = await db
    .select({
      id:        productionMembers.id,
      createdAt: productionMembers.createdAt,
      user: {
        id:            users.id,
        name:          users.name,
        firstName:     users.first_name,
        lastName:      users.last_name,
        email:         users.email,
        avatarImageId: users.avatarImageId,
        createdAt:     users.createdAt,
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
