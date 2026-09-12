import { eq, and } from 'drizzle-orm';
import { db, tracks } from '@starling/db';
import { defineEventHandler, getRouterParam, createError, getSocketId } from '../../../../lib/handler.js';
import { requireTimelineParam, assertTrackUnlocked } from '../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';
import { TimelineEvent } from '@starling/realtime';
import { emitTimelineChange } from '../../../../lib/timelineSockets.js';

export default defineEventHandler(async (event) => {
  const { timeline } = await requireTimelineParam(event, { permission: Permission.EDIT_TIMELINE });
  const trackId = getRouterParam(event, 'trackId')!;

  // Read before deleting: a locked track has to be told apart from a missing
  // one, and deleting it takes every clip with it — the exact loss the lock is
  // there to prevent.
  const [track] = await db.select({ id: tracks.id, isLocked: tracks.isLocked }).from(tracks)
    .where(and(eq(tracks.id, trackId), eq(tracks.timelineId, timeline.id)))
    .limit(1);
  if (!track) throw createError({ statusCode: 404, message: 'Track not found' });
  assertTrackUnlocked(track.isLocked);

  await db.delete(tracks).where(eq(tracks.id, trackId));

  emitTimelineChange(timeline.id, TimelineEvent.trackChange,
    { type: 'remove', trackId }, getSocketId(event));

  return { ok: true };
});
