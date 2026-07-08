import z from 'zod';
import { db, trackTypes } from '@starling/db';
import { defineEventHandler, readValidatedBody } from '../../../../lib/handler.js';
import { requireProductionParam } from '../../../../lib/production.js';
import { trackBehaviorCreateFields } from '../../../../lib/trackTypeSettings.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  name:        z.string().min(1).max(64),
  hue:         z.number().int().min(0).max(360).default(250),
  trackMode:   z.enum(['event', 'clip']).default('clip'),
  sourceSetId: z.string().uuid().nullable().optional(),
  sortOrder:   z.number().int().min(0).default(0),
  ...trackBehaviorCreateFields,
});

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event, { permission: Permission.MANAGE_TRACK_TYPES });
  const body = await readValidatedBody(event, bodySchema);

  const [trackType] = await db.insert(trackTypes).values({
    productionId: production.id,
    name:         body.name,
    hue:          body.hue,
    trackMode:    body.trackMode,
    sourceSetId:  body.sourceSetId ?? null,
    sortOrder:    body.sortOrder,
    trackDisplay: body.trackDisplay,
    nameDisplay:  body.nameDisplay,
    clipDisplay:  body.clipDisplay,
    metronome:    body.metronome,
    tts:          body.tts,
  }).returning();

  return trackType!;
});
