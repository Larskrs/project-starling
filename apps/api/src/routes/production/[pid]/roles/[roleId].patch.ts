import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, productionRoles } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError } from '../../../../lib/handler.js';
import { requireProductionParam } from '../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  name:        z.string().min(1).max(64).optional(),
  hue:         z.number().int().min(0).max(360).optional(),
  permissions: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event, { permission: Permission.MANAGE_ROLES });
  const roleId = getRouterParam(event, 'roleId')!;

  const body = await readValidatedBody(event, bodySchema);

  const update: Record<string, unknown> = {};
  if (body.name        !== undefined) update.name        = body.name;
  if (body.hue         !== undefined) update.hue         = body.hue;
  if (body.permissions !== undefined) update.permissions = BigInt(body.permissions);

  if (Object.keys(update).length === 0) throw createError({ statusCode: 422, message: 'Nothing to update' });

  const [updated] = await db.update(productionRoles)
    .set(update)
    .where(and(eq(productionRoles.id, roleId), eq(productionRoles.productionId, production.id)))
    .returning();

  if (!updated) throw createError({ statusCode: 404, message: 'Role not found' });

  return { ...updated, permissions: updated.permissions.toString() };
});
