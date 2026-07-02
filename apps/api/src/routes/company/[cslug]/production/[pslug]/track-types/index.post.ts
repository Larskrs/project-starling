import z from 'zod';
import { db, trackTypes } from '@starling/db';
import { defineEventHandler, readValidatedBody } from '../../../../../../lib/handler.js';
import { requireProductionRoute } from '../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  name:        z.string().min(1).max(64),
  color:       z.string().max(32).nullable().optional(),
  trackMode:   z.enum(['event', 'clip']).default('clip'),
  sourceSetId: z.string().uuid().nullable().optional(),
  sortOrder:   z.number().int().min(0).default(0),
});

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionRoute(event, { permission: Permission.MANAGE_TRACK_TYPES });
  const body = await readValidatedBody(event, bodySchema);

  const [trackType] = await db.insert(trackTypes).values({
    productionId: production.id,
    name:         body.name,
    color:        body.color ?? null,
    trackMode:    body.trackMode,
    sourceSetId:  body.sourceSetId ?? null,
    sortOrder:    body.sortOrder,
  }).returning();

  return trackType!;
});
