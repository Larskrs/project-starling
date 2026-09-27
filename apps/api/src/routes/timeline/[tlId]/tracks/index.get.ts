import { eq } from 'drizzle-orm';
import { db, tracks } from '@starling/db';
import { defineEventHandler } from '../../../../lib/http/handler.js';
import { requireTimelineParam } from '../../../../lib/access/production.js';

export default defineEventHandler(async (event) => {
  const { timeline } = await requireTimelineParam(event);

  return db.select().from(tracks)
    .where(eq(tracks.timelineId, timeline.id))
    .orderBy(tracks.sortOrder, tracks.createdAt);
});
