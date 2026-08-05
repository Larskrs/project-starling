import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, tracks } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError, pickDefined } from '../../../../lib/handler.js';
import { requireTimelineParam, assertTrackUnlocked } from '../../../../lib/production.js';
import { iconField } from '../../../../lib/icons.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  name:      z.string().min(1).max(128).optional(),
  icon:      iconField,
  isMuted:   z.boolean().optional(),
  isLocked:  z.boolean().optional(),
  sourceId:  z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export default defineEventHandler(async (event) => {
  const { timeline } = await requireTimelineParam(event, { permission: Permission.EDIT_TIMELINE });
  const trackId = getRouterParam(event, 'trackId')!;

  const update = pickDefined(await readValidatedBody(event, bodySchema));
  if (Object.keys(update).length === 0) throw createError({ statusCode: 422, message: 'Nothing to update' });

  // A locked track accepts exactly one change: the lock itself. Anything else
  // would let a rename or a re-point slip past the guard — and blocking the
  // whole route would make the lock impossible to release.
  const lockOnly = Object.keys(update).every(k => k === 'isLocked');
  if (!lockOnly) {
    const [current] = await db.select({ isLocked: tracks.isLocked }).from(tracks)
      .where(and(eq(tracks.id, trackId), eq(tracks.timelineId, timeline.id)))
      .limit(1);
    if (!current) throw createError({ statusCode: 404, message: 'Track not found' });
    assertTrackUnlocked(current.isLocked);
  }

  const [updated] = await db.update(tracks)
    .set(update)
    .where(and(eq(tracks.id, trackId), eq(tracks.timelineId, timeline.id)))
    .returning();

  if (!updated) throw createError({ statusCode: 404, message: 'Track not found' });

  return updated;
});
