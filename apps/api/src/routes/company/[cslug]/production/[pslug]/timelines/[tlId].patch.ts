import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, timelines, frameRateEnum } from '@starling/db';
import { defineEventHandler, readValidatedBody, createError, pickDefined } from '../../../../../../lib/handler.js';
import { requireProductionRoute } from '../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  name:            z.string().min(1).max(128).optional(),
  frameRate:       z.enum(frameRateEnum.enumValues).optional(),
  startFrame:      z.number().int().min(0).optional(),
  endFrame:        z.number().int().min(1).optional(),
  ltcOffsetFrames: z.number().int().optional(),
});

export default defineEventHandler(async (event) => {
  const { production, params } = await requireProductionRoute(event, {
    permission: Permission.MANAGE_TIMELINES,
    params:     ['tlId'],
  });

  const update = pickDefined(await readValidatedBody(event, bodySchema));
  if (Object.keys(update).length === 0) throw createError({ statusCode: 422, message: 'Nothing to update' });

  const [updated] = await db.update(timelines)
    .set({ ...update, updatedAt: new Date() })
    .where(and(eq(timelines.id, params.tlId!), eq(timelines.productionId, production.id)))
    .returning();

  if (!updated) throw createError({ statusCode: 404, message: 'Timeline not found' });

  return updated;
});
