import { eq, and } from 'drizzle-orm';
import { db, tracks, clips } from '@starling/db';
import { defineEventHandler, getRouterParam, createError, getSocketId } from '../../../../lib/handler.js';
import { requireTimelineParam, assertTrackUnlocked } from '../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';
import { timelineRelay } from '../../../../lib/timelineSockets.js';

export default defineEventHandler(async (event) => {
  const { timeline } = await requireTimelineParam(event, { permission: Permission.EDIT_TIMELINE });
  const clipId = getRouterParam(event, 'clipId')!;

  const [owned] = await db.select({ id: clips.id, isLocked: tracks.isLocked }).from(clips)
    .innerJoin(tracks, eq(clips.trackId, tracks.id))
    .where(and(eq(clips.id, clipId), eq(tracks.timelineId, timeline.id)))
    .limit(1);
  if (!owned) throw createError({ statusCode: 404, message: 'Clip not found' });
  assertTrackUnlocked(owned.isLocked);

  await db.delete(clips).where(eq(clips.id, clipId));

  // Relayed here rather than by the client, so peers do not wait for this
  // request's round trip to finish first. See timelineRelay.
  timelineRelay.clipRemoved(timeline.id, clipId, getSocketId(event));

  return { ok: true };
});
