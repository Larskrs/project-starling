import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, tracks, clips } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError, pickDefined } from '../../../../lib/handler.js';
import { requireTimelineParam } from '../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  label:      z.string().max(256).optional(),
  position:   z.number().int().min(0).optional(),
  fileId:     z.string().uuid().nullable().optional(),
  mediaStart: z.number().int().min(0).nullable().optional(),
  end:        z.number().int().min(0).nullable().optional(),
  sourceId:   z.string().uuid().nullable().optional(),
  hue:        z.number().int().min(0).max(360).nullable().optional(),
  data:       z.any().optional(),
});

export default defineEventHandler(async (event) => {
  const { timeline } = await requireTimelineParam(event, { permission: Permission.EDIT_TIMELINE });
  const clipId = getRouterParam(event, 'clipId')!;

  // Confirm the clip hangs off a track in this timeline.
  const [owned] = await db.select({ id: clips.id }).from(clips)
    .innerJoin(tracks, eq(clips.trackId, tracks.id))
    .where(and(eq(clips.id, clipId), eq(tracks.timelineId, timeline.id)))
    .limit(1);
  if (!owned) throw createError({ statusCode: 404, message: 'Clip not found' });

  const update = pickDefined(await readValidatedBody(event, bodySchema));
  if (Object.keys(update).length === 0) throw createError({ statusCode: 422, message: 'Nothing to update' });

  const [updated] = await db.update(clips)
    .set({ ...update, updatedAt: new Date() })
    .where(eq(clips.id, clipId))
    .returning();

  return updated;
});
