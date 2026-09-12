import { eq, and } from 'drizzle-orm';
import { db, tracks, clips } from '@starling/db';
import { defineEventHandler, getRouterParam, createError, getSocketId } from '../../../../lib/handler.js';
import { requireTimelineParam, assertTrackUnlocked } from '../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';
import { TimelineEvent } from '@starling/realtime';
import { emitTimelineChange } from '../../../../lib/timelineSockets.js';

export default defineEventHandler(async (event) => {
  const { timeline } = await requireTimelineParam(event, { permission: Permission.EDIT_TIMELINE });
  const clipId = getRouterParam(event, 'clipId')!;

  // trackId rides along for the relay below: peers key clips by track, and once
  // the row is deleted there is nothing left to look it up from.
  const [owned] = await db.select({ id: clips.id, trackId: clips.trackId, isLocked: tracks.isLocked }).from(clips)
    .innerJoin(tracks, eq(clips.trackId, tracks.id))
    .where(and(eq(clips.id, clipId), eq(tracks.timelineId, timeline.id)))
    .limit(1);
  if (!owned) throw createError({ statusCode: 404, message: 'Clip not found' });
  assertTrackUnlocked(owned.isLocked);

  await db.delete(clips).where(eq(clips.id, clipId));

  // Relayed here rather than by the client, so peers do not wait for this
  // request's round trip to finish first. See emitTimelineChange.
  emitTimelineChange(timeline.id, TimelineEvent.clipChange,
    { type: 'remove', trackId: owned.trackId, clipId }, getSocketId(event));

  return { ok: true };
});
