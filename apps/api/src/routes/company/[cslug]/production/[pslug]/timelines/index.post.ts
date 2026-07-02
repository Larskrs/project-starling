import z from 'zod';
import { db, timelines } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError } from '../../../../../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const FRAME_RATES = ['23.976', '24', '25', '29.97', '29.97df', '30', '50', '59.94', '60'] as const;

const bodySchema = z.object({
  name:            z.string().min(1).max(128),
  frameRate:       z.enum(FRAME_RATES).default('25'),
  startFrame:      z.number().int().min(0).default(0),
  endFrame:        z.number().int().min(1),
  ltcOffsetFrames: z.number().int().default(0),
}).refine(d => d.endFrame > d.startFrame, {
  message: 'End frame must be after start frame',
  path: ['endFrame'],
});

export default defineEventHandler(async (event) => {
  const cslug = getRouterParam(event, 'cslug');
  const pslug = getRouterParam(event, 'pslug');
  if (!cslug || !pslug) throw createError({ statusCode: 400, message: 'Missing slugs' });

  const ctx = await requireProductionAccess(event, { cslug, pslug });
  await requirePermission(ctx, Permission.ADMINISTRATOR);

  const { production } = ctx;
  const body = await readValidatedBody(event, bodySchema);

  const [timeline] = await db.insert(timelines).values({
    productionId:    production.id,
    name:            body.name,
    frameRate:       body.frameRate,
    startFrame:      body.startFrame,
    endFrame:        body.endFrame,
    ltcOffsetFrames: body.ltcOffsetFrames,
  }).returning();

  return timeline!;
});
