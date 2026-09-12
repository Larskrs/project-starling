import z from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { db, tracks, trackTypes } from '@starling/db';
import { defineEventHandler, readValidatedBody, createError, getSocketId } from '../../../../lib/handler.js';
import { requireTimelineParam } from '../../../../lib/production.js';
import { iconField } from '../../../../lib/icons.js';
import { Permission } from '@starling/auth/permissions';
import { TimelineEvent } from '@starling/realtime';
import { emitTimelineChange } from '../../../../lib/timelineSockets.js';

const bodySchema = z.object({
  typeId:    z.uuid(),
  name:      z.string().min(1).max(128),
  icon:      iconField,
  sourceId:  z.uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export default defineEventHandler(async (event) => {
  const { production, timeline } = await requireTimelineParam(event, { permission: Permission.EDIT_TIMELINE });

  const body = await readValidatedBody(event, bodySchema);

  const [trackType] = await db.select().from(trackTypes)
    .where(and(eq(trackTypes.id, body.typeId), eq(trackTypes.productionId, production.id)))
    .limit(1);
  if (!trackType) throw createError({ statusCode: 404, message: 'Track type not found' });

  // New tracks append to the end of the timeline's order unless told otherwise.
  let sortOrder = body.sortOrder;
  if (sortOrder == null) {
    const [row] = await db.select({ max: sql<number>`coalesce(max(${tracks.sortOrder}), -1)` })
      .from(tracks).where(eq(tracks.timelineId, timeline.id));
    sortOrder = Number(row?.max ?? -1) + 1;
  }

  const [track] = await db.insert(tracks).values({
    timelineId: timeline.id,
    typeId:     body.typeId,
    name:       body.name,
    icon:       body.icon ?? null,
    mode:       trackType.trackMode,
    sourceId:   body.sourceId ?? null,
    sortOrder,
  }).returning();

  emitTimelineChange(timeline.id, TimelineEvent.trackChange,
    { type: 'upsert', track: track! }, getSocketId(event));

  return track!;
});
