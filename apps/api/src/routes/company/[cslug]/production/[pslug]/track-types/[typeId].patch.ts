import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, trackTypes } from '@starling/db';
import { defineEventHandler, readValidatedBody, createError, pickDefined } from '../../../../../../lib/handler.js';
import { requireProductionRoute } from '../../../../../../lib/production.js';
import { trackBehaviorPatchFields } from '../../../../../../lib/trackTypeSettings.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  name:        z.string().min(1).max(64).optional(),
  hue:         z.number().int().min(0).max(360).optional(),
  trackMode:   z.enum(['event', 'clip']).optional(),
  sourceSetId: z.string().uuid().nullable().optional(),
  sortOrder:   z.number().int().min(0).optional(),
  ...trackBehaviorPatchFields,
});

export default defineEventHandler(async (event) => {
  const { production, params } = await requireProductionRoute(event, {
    permission: Permission.MANAGE_TRACK_TYPES,
    params:     ['typeId'],
  });

  const update = pickDefined(await readValidatedBody(event, bodySchema));
  if (Object.keys(update).length === 0) throw createError({ statusCode: 422, message: 'Nothing to update' });

  const [updated] = await db.update(trackTypes)
    .set(update)
    .where(and(eq(trackTypes.id, params.typeId!), eq(trackTypes.productionId, production.id)))
    .returning();

  if (!updated) throw createError({ statusCode: 404, message: 'Track type not found' });

  return updated;
});
