import z from 'zod';
import { db, sourceSet } from '@starling/db';
import { defineEventHandler, readValidatedBody } from '../../../../lib/handler.js';
import { requireProductionParam } from '../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  name: z.string().min(1).max(128),
});

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event, { permission: Permission.MANAGE_TRACK_TYPES });
  const body = await readValidatedBody(event, bodySchema);

  const [set] = await db.insert(sourceSet).values({
    productionId: production.id,
    name:         body.name,
  }).returning();

  return set!;
});
