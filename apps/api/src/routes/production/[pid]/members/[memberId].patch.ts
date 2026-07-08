import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, productionMembers } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError } from '../../../../lib/handler.js';
import { requireProductionParam } from '../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  roleId: z.string().uuid().nullable(),
});

export default defineEventHandler(async (event) => {
  const ctx = await requireProductionParam(event, { permission: Permission.MANAGE_MEMBERS });
  const memberId = getRouterParam(event, 'memberId')!;

  const [target] = await db.select({ id: productionMembers.id, userId: productionMembers.userId })
    .from(productionMembers)
    .where(and(eq(productionMembers.id, memberId), eq(productionMembers.productionId, ctx.production.id)))
    .limit(1);
  if (!target) throw createError({ statusCode: 404, message: 'Member not found' });

  if (!ctx.privileged && target.userId === ctx.auth.userId)
    throw createError({ statusCode: 403, message: 'You cannot change your own role' });

  const body = await readValidatedBody(event, bodySchema);

  const [updated] = await db.update(productionMembers)
    .set({ roleId: body.roleId })
    .where(eq(productionMembers.id, memberId))
    .returning();

  if (!updated) throw createError({ statusCode: 404, message: 'Member not found' });

  return updated;
});
