import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, timelines, tracks } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError } from '../../../../../../../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  name:      z.string().min(1).max(128).optional(),
  isMuted:   z.boolean().optional(),
  isLocked:  z.boolean().optional(),
  sourceId:  z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

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

  const body = await readValidatedBody(event, bodySchema);

  const update: Record<string, unknown> = {};
  if (body.name      !== undefined) update.name      = body.name;
  if (body.isMuted   !== undefined) update.isMuted   = body.isMuted;
  if (body.isLocked  !== undefined) update.isLocked  = body.isLocked;
  if (body.sourceId  !== undefined) update.sourceId  = body.sourceId;
  if (body.sortOrder !== undefined) update.sortOrder = body.sortOrder;

  if (Object.keys(update).length === 0) throw createError({ statusCode: 422, message: 'Nothing to update' });

  const [updated] = await db.update(tracks)
    .set(update)
    .where(and(eq(tracks.id, trackId), eq(tracks.timelineId, tlId)))
    .returning();

  if (!updated) throw createError({ statusCode: 404, message: 'Track not found' });

  return updated;
});
