import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, timelines, tracks, clips } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError } from '../../../../../../../../../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../../../../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  label:      z.string().max(256).default(''),
  position:   z.number().int().min(0),
  fileId:     z.string().uuid().nullable().optional(),
  mediaStart: z.number().int().min(0).nullable().optional(),
  end:        z.number().int().min(0).nullable().optional(),
  sourceId:   z.string().uuid().nullable().optional(),
  hue:        z.number().int().min(0).max(360).nullable().optional(),
  data:       z.any().optional(),
}).refine(
  d => !(d.mediaStart !== null && d.mediaStart !== undefined && d.end !== null && d.end !== undefined) || d.end > d.mediaStart,
  { message: 'end must be greater than mediaStart', path: ['end'] },
);

export default defineEventHandler(async (event) => {
  const cslug   = getRouterParam(event, 'cslug');
  const pslug   = getRouterParam(event, 'pslug');
  const tlId    = getRouterParam(event, 'tlId');
  const trackId = getRouterParam(event, 'trackId');
  if (!cslug || !pslug || !tlId || !trackId) throw createError({ statusCode: 400, message: 'Missing params' });

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

  const [clip] = await db.insert(clips).values({
    trackId,
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
