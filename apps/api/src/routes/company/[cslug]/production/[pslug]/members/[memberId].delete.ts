import { eq, and } from 'drizzle-orm';
import { db, productionMembers } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../../../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

export default defineEventHandler(async (event) => {
  const cslug    = getRouterParam(event, 'cslug');
  const pslug    = getRouterParam(event, 'pslug');
  const memberId = getRouterParam(event, 'memberId');
  if (!cslug || !pslug || !memberId) throw createError({ statusCode: 400, message: 'Missing params' });

  const ctx = await requireProductionAccess(event, { cslug, pslug });
  await requirePermission(ctx, Permission.MANAGE_MEMBERS);

  const { production } = ctx;

  const [target] = await db.select({ id: productionMembers.id, userId: productionMembers.userId })
    .from(productionMembers)
    .where(and(eq(productionMembers.id, memberId), eq(productionMembers.productionId, production.id)))
    .limit(1);
  if (!target) throw createError({ statusCode: 404, message: 'Member not found' });

  if (!ctx.privileged && target.userId === ctx.auth.userId)
    throw createError({ statusCode: 403, message: 'You cannot remove yourself from a production' });

  const [deleted] = await db.delete(productionMembers)
    .where(eq(productionMembers.id, memberId))
    .returning();

  if (!deleted) throw createError({ statusCode: 404, message: 'Member not found' });

  return { ok: true };
});
