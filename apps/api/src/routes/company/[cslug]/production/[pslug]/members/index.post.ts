import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, productionMembers, users } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError } from '../../../../../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  email:  z.string().email(),
  roleId: z.string().uuid().optional(),
});

export default defineEventHandler(async (event) => {
  const cslug = getRouterParam(event, 'cslug');
  const pslug = getRouterParam(event, 'pslug');
  if (!cslug || !pslug) throw createError({ statusCode: 400, message: 'Missing slugs' });

  const ctx = await requireProductionAccess(event, { cslug, pslug });
  await requirePermission(ctx, Permission.MANAGE_MEMBERS);

  const { production } = ctx;
  const body = await readValidatedBody(event, bodySchema);

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
  if (!user) throw createError({ statusCode: 404, message: 'User not found' });

  const [existing] = await db.select({ id: productionMembers.id })
    .from(productionMembers)
    .where(and(eq(productionMembers.productionId, production.id), eq(productionMembers.userId, user.id)))
    .limit(1);
  if (existing) throw createError({ statusCode: 409, message: 'User is already a member' });

  const [member] = await db.insert(productionMembers).values({
    productionId: production.id,
    userId:       user.id,
    roleId:       body.roleId ?? null,
  }).returning();

  return member;
});
