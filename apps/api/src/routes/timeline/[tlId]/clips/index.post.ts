import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, tracks, clips } from '@starling/db';
import { defineEventHandler, readValidatedBody, createError } from '../../../../lib/handler.js';
import { requireTimelineParam } from '../../../../lib/production.js';
import { clipDataSchema } from '../../../../lib/clipData.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  trackId:    z.string().uuid(),
  label:      z.string().max(256).default(''),
  position:   z.number().int().min(0),
  fileId:     z.string().uuid().nullable().optional(),
  mediaStart: z.number().int().min(0).nullable().optional(),
  end:        z.number().int().min(0).nullable().optional(),
  sourceId:   z.string().uuid().nullable().optional(),
  hue:        z.number().int().min(0).max(360).nullable().optional(),
  data:       clipDataSchema.nullable().optional(),
}).refine(
  d => !(d.mediaStart !== null && d.mediaStart !== undefined && d.end !== null && d.end !== undefined) || d.end > d.mediaStart,
  { message: 'end must be greater than mediaStart', path: ['end'] },
);

export default defineEventHandler(async (event) => {
  const { timeline } = await requireTimelineParam(event, { permission: Permission.EDIT_TIMELINE });

  const body = await readValidatedBody(event, bodySchema);

  // The track must belong to this timeline.
  const [track] = await db.select({ id: tracks.id }).from(tracks)
    .where(and(eq(tracks.id, body.trackId), eq(tracks.timelineId, timeline.id)))
    .limit(1);
  if (!track) throw createError({ statusCode: 404, message: 'Track not found' });

  const [clip] = await db.insert(clips).values({
    trackId:    body.trackId,
    label:      body.label,
    position:   body.position,
    fileId:     body.fileId ?? null,
    mediaStart: body.mediaStart ?? null,
    end:        body.end ?? null,
    sourceId:   body.sourceId ?? null,
    hue:        body.hue ?? null,
    data:       body.data ?? null,
  }).returning();

  return clip!;
});
