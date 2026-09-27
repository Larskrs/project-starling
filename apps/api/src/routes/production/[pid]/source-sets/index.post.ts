import z from 'zod';
import { db, sourceSet } from '@starling/db';
import { defineEventHandler, readValidatedBody } from '../../../../lib/http/handler.js';
import { requireProductionParam } from '../../../../lib/access/production.js';
import { iconField } from '../../../../lib/timeline/icons.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  name: z.string().min(1).max(128),
  icon: iconField,
});

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event, { permission: Permission.MANAGE_TRACK_TYPES });
  const body = await readValidatedBody(event, bodySchema);

  const [set] = await db.insert(sourceSet).values({
    productionId: production.id,
    name:         body.name,
    icon:         body.icon ?? null,
  }).returning();

  return set!;
});
