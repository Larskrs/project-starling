import { eq } from 'drizzle-orm';
import { db, timelines, storageFiles, storageImageVersions } from '@starling/db';
import { defineEventHandler, readMultipart, ApiError } from '../../../lib/handler.js';
import { isImage, writeTimelineProfileImage, purgeFilesFromDisk } from '../../../lib/storage.js';
import { requireTimelineParam } from '../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

/**
 * Timeline profile image — same flow as the company/production profile routes
 * (replace old file, fan out quality versions, point the row at the new file),
 * minus the `slot` field: a timeline has one image, no banner.
 */
export default defineEventHandler(async (event) => {
  const { company, production, timeline } = await requireTimelineParam(event, {
    permission: Permission.MANAGE_TIMELINES,
  });

  const { files } = await readMultipart(event);

  const upload = files['file'];
  if (!upload) throw new ApiError(400, 'No file field in request');
  if (!isImage(upload.mimeType)) throw new ApiError(415, 'Only image types are allowed for profile images');

  if (timeline.profileImageId) {
    const [oldFile] = await db.select().from(storageFiles).where(eq(storageFiles.id, timeline.profileImageId)).limit(1);
    if (oldFile) {
      await purgeFilesFromDisk([oldFile]);
      await db.delete(storageFiles).where(eq(storageFiles.id, oldFile.id));
    }
  }

  // productionId is set so the production's storage teardown sweeps this up.
  const [file] = await db.insert(storageFiles).values({
    productionId: production.id,
    folderId:     null,
    name:         `profile-${upload.filename}`,
    mimeType:     upload.mimeType,
    size:         upload.data.length,
    type:         'image',
    physicalPath: '',
    hidden:       true,
  }).returning();

  const versions = await writeTimelineProfileImage(upload.data, company.id, production.id, timeline.id, file.id);

  await db.insert(storageImageVersions).values(
    versions.map((v) => ({ fileId: file.id, ...v })),
  );

  const physicalPath = versions.reduce((best, v) => v.quality > best.quality ? v : best).physicalPath;
  const totalSize    = versions.reduce((sum, v) => sum + v.size, 0);

  await db.update(storageFiles)
    .set({ physicalPath, size: totalSize })
    .where(eq(storageFiles.id, file.id));

  await db.update(timelines)
    .set({ profileImageId: file.id })
    .where(eq(timelines.id, timeline.id));

  return { fileId: file.id, versions: versions.length };
});
