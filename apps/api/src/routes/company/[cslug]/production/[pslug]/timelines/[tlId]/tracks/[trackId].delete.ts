import { eq, and } from 'drizzle-orm';
import { db, timelines, tracks } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../../../../../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

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

  const [deleted] = await db.delete(tracks)
    .where(and(eq(tracks.id, trackId), eq(tracks.timelineId, tlId)))
    .returning();

  if (!deleted) throw createError({ statusCode: 404, message: 'Track not found' });

  return { ok: true };
});
