import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, tracks, trackTypes } from '@starling/db';
import { defineEventHandler, readValidatedBody, createError } from '../../../../lib/handler.js';
import { requireTimelineParam } from '../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  typeId:    z.string().uuid(),
  name:      z.string().min(1).max(128),
  sourceId:  z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export default defineEventHandler(async (event) => {
  const { production, timeline } = await requireTimelineParam(event, { permission: Permission.EDIT_TIMELINE });

  const body = await readValidatedBody(event, bodySchema);

  const [trackType] = await db.select().from(trackTypes)
    .where(and(eq(trackTypes.id, body.typeId), eq(trackTypes.productionId, production.id)))
    .limit(1);
  if (!trackType) throw createError({ statusCode: 404, message: 'Track type not found' });

  const [track] = await db.insert(tracks).values({
    timelineId: timeline.id,
    typeId:     body.typeId,
    name:       body.name,
    mode:       trackType.trackMode,
    sourceId:   body.sourceId ?? null,
    sortOrder:  body.sortOrder ?? 0,
  }).returning();

  return track!;
});
