import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, sourceSet } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError } from '../../../../../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  name: z.string().min(1).max(128),
});

export default defineEventHandler(async (event) => {
  const cslug = getRouterParam(event, 'cslug');
  const pslug = getRouterParam(event, 'pslug');
  const setId = getRouterParam(event, 'setId');
  if (!cslug || !pslug || !setId) throw createError({ statusCode: 400, message: 'Missing params' });

  const ctx = await requireProductionAccess(event, { cslug, pslug });
  await requirePermission(ctx, Permission.ADMINISTRATOR);

  const { production } = ctx;
  const body = await readValidatedBody(event, bodySchema);

  const [updated] = await db.update(sourceSet)
    .set({ name: body.name, updatedAt: new Date() })
    .where(and(eq(sourceSet.id, setId), eq(sourceSet.productionId, production.id)))
    .returning();

  if (!updated) throw createError({ statusCode: 404, message: 'Source set not found' });

  return updated;
});
