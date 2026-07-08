import z from 'zod';
import { db, timelines, frameRateEnum } from '@starling/db';
import { defineEventHandler, readValidatedBody } from '../../lib/handler.js';
import { requireProductionQuery } from '../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  name:            z.string().min(1).max(128),
  frameRate:       z.enum(frameRateEnum.enumValues).default('25'),
  startFrame:      z.number().int().min(0).default(0),
  endFrame:        z.number().int().min(1),
  ltcOffsetFrames: z.number().int().default(0),
}).refine(d => d.endFrame > d.startFrame, {
  message: 'End frame must be after start frame',
  path: ['endFrame'],
});

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionQuery(event, { permission: Permission.MANAGE_TIMELINES });
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
