import { eq } from 'drizzle-orm';
import { db, timelines, storageFiles } from '@starling/db';
import { defineEventHandler } from '../../../lib/handler.js';
import { requireTimelineParam } from '../../../lib/production.js';
import { purgeFilesFromDisk } from '../../../lib/storage.js';
import { Permission } from '@starling/auth/permissions';

export default defineEventHandler(async (event) => {
  const { timeline } = await requireTimelineParam(event, { permission: Permission.MANAGE_TIMELINES });

  // The profile image is a hidden storageFiles row with no FK back to the
  // timeline, so nothing cascades — take it down explicitly.
  if (timeline.profileImageId) {
    const [image] = await db.select().from(storageFiles).where(eq(storageFiles.id, timeline.profileImageId)).limit(1);
    if (image) {
      await purgeFilesFromDisk([image]);
      await db.delete(storageFiles).where(eq(storageFiles.id, image.id));
    }
  }

  await db.delete(timelines).where(eq(timelines.id, timeline.id));

  return { ok: true };
});
