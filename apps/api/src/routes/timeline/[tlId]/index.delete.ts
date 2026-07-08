import { eq } from 'drizzle-orm';
import { db, timelines } from '@starling/db';
import { defineEventHandler } from '../../../lib/handler.js';
import { requireTimelineParam } from '../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

export default defineEventHandler(async (event) => {
  const { timeline } = await requireTimelineParam(event, { permission: Permission.MANAGE_TIMELINES });

  await db.delete(timelines).where(eq(timelines.id, timeline.id));

  return { ok: true };
});
