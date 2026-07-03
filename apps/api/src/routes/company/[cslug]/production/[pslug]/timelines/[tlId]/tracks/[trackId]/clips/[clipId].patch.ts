import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, timelines, tracks, clips } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError } from '../../../../../../../../../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../../../../../../../../../lib/production.js';
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
  const cslug   = getRouterParam(event, 'cslug');
  const pslug   = getRouterParam(event, 'pslug');
  const tlId    = getRouterParam(event, 'tlId');
  const trackId = getRouterParam(event, 'trackId');
  const clipId  = getRouterParam(event, 'clipId');
  if (!cslug || !pslug || !tlId || !trackId || !clipId) throw createError({ statusCode: 400, message: 'Missing params' });

  const ctx = await requireProductionAccess(event, { cslug, pslug });
  await requirePermission(ctx, Permission.EDIT_TIMELINE);

  const { production } = ctx;

  const [timeline] = await db.select({ id: timelines.id }).from(timelines)
    .where(and(eq(timelines.id, tlId), eq(timelines.productionId, production.id)))
    .limit(1);
  if (!timeline) throw createError({ statusCode: 404, message: 'Timeline not found' });

  const [track] = await db.select({ id: tracks.id }).from(tracks)
    .where(and(eq(tracks.id, trackId), eq(tracks.timelineId, tlId)))
    .limit(1);
  if (!track) throw createError({ statusCode: 404, message: 'Track not found' });

  const body = await readValidatedBody(event, bodySchema);

  const update: Record<string, unknown> = {};
  if (body.label      !== undefined) update.label      = body.label;
  if (body.position   !== undefined) update.position   = body.position;
  if (body.fileId     !== undefined) update.fileId     = body.fileId;
  if (body.mediaStart !== undefined) update.mediaStart = body.mediaStart;
  if (body.end        !== undefined) update.end        = body.end;
  if (body.sourceId   !== undefined) update.sourceId   = body.sourceId;
  if (body.hue        !== undefined) update.hue        = body.hue;
  if (body.data       !== undefined) update.data       = body.data;

  if (Object.keys(update).length === 0) throw createError({ statusCode: 422, message: 'Nothing to update' });

  update.updatedAt = new Date();

  const [updated] = await db.update(clips)
    .set(update)
    .where(and(eq(clips.id, clipId), eq(clips.trackId, trackId)))
    .returning();

  if (!updated) throw createError({ statusCode: 404, message: 'Clip not found' });

  return updated;
});
