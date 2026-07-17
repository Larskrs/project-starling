import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, tracks, clips } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError, pickDefined } from '../../../../lib/handler.js';
import { requireTimelineParam, requirePermission } from '../../../../lib/production.js';
import { clipDataSchema } from '../../../../lib/clipData.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  label:      z.string().max(256).optional(),
  position:   z.number().int().min(0).optional(),
  fileId:     z.string().uuid().nullable().optional(),
  mediaStart: z.number().int().min(0).nullable().optional(),
  end:        z.number().int().min(0).nullable().optional(),
  sourceId:   z.string().uuid().nullable().optional(),
  hue:        z.number().int().min(0).max(360).nullable().optional(),
  data:       clipDataSchema.nullable().optional(),
});

export default defineEventHandler(async (event) => {
  const ctx = await requireTimelineParam(event);
  const clipId = getRouterParam(event, 'clipId')!;

  const update = pickDefined(await readValidatedBody(event, bodySchema));
  if (Object.keys(update).length === 0) throw createError({ statusCode: 422, message: 'Nothing to update' });

  // Renaming (label-only patches) has its own permission so a role can relabel
  // clips without full timeline editing; EDIT_TIMELINE covers renaming too.
  const labelOnly = Object.keys(update).every(k => k === 'label');
  await requirePermission(ctx, labelOnly
    ? (Permission.RENAME_CLIPS | Permission.EDIT_TIMELINE)
    : Permission.EDIT_TIMELINE);

  // Confirm the clip hangs off a track in this timeline.
  const [owned] = await db.select({ id: clips.id }).from(clips)
    .innerJoin(tracks, eq(clips.trackId, tracks.id))
    .where(and(eq(clips.id, clipId), eq(tracks.timelineId, ctx.timeline.id)))
    .limit(1);
  if (!owned) throw createError({ statusCode: 404, message: 'Clip not found' });

  const [updated] = await db.update(clips)
    .set({ ...update, updatedAt: new Date() })
    .where(eq(clips.id, clipId))
    .returning();

  return updated;
});
