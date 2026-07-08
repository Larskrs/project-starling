import { eq, and } from 'drizzle-orm';
import { db, tracks } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../../lib/handler.js';
import { requireTimelineParam } from '../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

export default defineEventHandler(async (event) => {
  const { timeline } = await requireTimelineParam(event, { permission: Permission.EDIT_TIMELINE });
  const trackId = getRouterParam(event, 'trackId')!;

  const [deleted] = await db.delete(tracks)
    .where(and(eq(tracks.id, trackId), eq(tracks.timelineId, timeline.id)))
    .returning();

  if (!deleted) throw createError({ statusCode: 404, message: 'Track not found' });

  return { ok: true };
});
