import z from 'zod';
import { db, productionRoles } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError } from '../../../../../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  name:        z.string().min(1).max(64),
  hue:         z.number().int().min(0).max(360),
  permissions: z.string().default('0'),
});

export default defineEventHandler(async (event) => {
  const cslug = getRouterParam(event, 'cslug');
  const pslug = getRouterParam(event, 'pslug');
  if (!cslug || !pslug) throw createError({ statusCode: 400, message: 'Missing slugs' });

  const ctx = await requireProductionAccess(event, { cslug, pslug });
  await requirePermission(ctx, Permission.MANAGE_ROLES);

  const { production } = ctx;
  const body = await readValidatedBody(event, bodySchema);

  const [role] = await db.insert(productionRoles).values({
    productionId: production.id,
    name:         body.name,
    hue:          body.hue,
    permissions:  BigInt(body.permissions),
  }).returning();

  return { ...role!, permissions: role!.permissions.toString() };
});
