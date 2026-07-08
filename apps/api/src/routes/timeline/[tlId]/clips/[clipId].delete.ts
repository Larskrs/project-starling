import { eq, and } from 'drizzle-orm';
import { db, tracks, clips } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../../lib/handler.js';
import { requireTimelineParam } from '../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

export default defineEventHandler(async (event) => {
  const { timeline } = await requireTimelineParam(event, { permission: Permission.EDIT_TIMELINE });
  const clipId = getRouterParam(event, 'clipId')!;

  const [owned] = await db.select({ id: clips.id }).from(clips)
    .innerJoin(tracks, eq(clips.trackId, tracks.id))
    .where(and(eq(clips.id, clipId), eq(tracks.timelineId, timeline.id)))
    .limit(1);
  if (!owned) throw createError({ statusCode: 404, message: 'Clip not found' });

  await db.delete(clips).where(eq(clips.id, clipId));

  return { ok: true };
});
