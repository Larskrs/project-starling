import z from 'zod';
import { db, productionRoles } from '@starling/db';
import { defineEventHandler, readValidatedBody } from '../../../../lib/handler.js';
import { requireProductionParam } from '../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  name:        z.string().min(1).max(64),
  hue:         z.number().int().min(0).max(360),
  permissions: z.string().default('0'),
});

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event, { permission: Permission.MANAGE_ROLES });

  const body = await readValidatedBody(event, bodySchema);

  const [role] = await db.insert(productionRoles).values({
    productionId: production.id,
    name:         body.name,
    hue:          body.hue,
    permissions:  BigInt(body.permissions),
  }).returning();

  return { ...role!, permissions: role!.permissions.toString() };
});
