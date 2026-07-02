import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, timelines } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError } from '../../../../../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const FRAME_RATES = ['23.976', '24', '25', '29.97', '29.97df', '30', '50', '59.94', '60'] as const;

const bodySchema = z.object({
  name:            z.string().min(1).max(128).optional(),
  frameRate:       z.enum(FRAME_RATES).optional(),
  startFrame:      z.number().int().min(0).optional(),
  endFrame:        z.number().int().min(1).optional(),
  ltcOffsetFrames: z.number().int().optional(),
});

export default defineEventHandler(async (event) => {
  const cslug = getRouterParam(event, 'cslug');
  const pslug = getRouterParam(event, 'pslug');
  const tlId  = getRouterParam(event, 'tlId');
  if (!cslug || !pslug || !tlId) throw createError({ statusCode: 400, message: 'Missing params' });

  const ctx = await requireProductionAccess(event, { cslug, pslug });
  await requirePermission(ctx, Permission.ADMINISTRATOR);

  const { production } = ctx;
  const body = await readValidatedBody(event, bodySchema);

  const update: Record<string, unknown> = {};
  if (body.name            !== undefined) update.name            = body.name;
  if (body.frameRate       !== undefined) update.frameRate       = body.frameRate;
  if (body.startFrame      !== undefined) update.startFrame      = body.startFrame;
  if (body.endFrame        !== undefined) update.endFrame        = body.endFrame;
  if (body.ltcOffsetFrames !== undefined) update.ltcOffsetFrames = body.ltcOffsetFrames;

  if (Object.keys(update).length === 0) throw createError({ statusCode: 422, message: 'Nothing to update' });

  update.updatedAt = new Date();

  const [updated] = await db.update(timelines)
    .set(update)
    .where(and(eq(timelines.id, tlId), eq(timelines.productionId, production.id)))
    .returning();

  if (!updated) throw createError({ statusCode: 404, message: 'Timeline not found' });

  return updated;
});
