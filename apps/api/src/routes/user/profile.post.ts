import z from 'zod';
import { eq } from 'drizzle-orm';
import { db, users, storageFiles, storageImageVersions } from '@starling/db';
import { defineEventHandler, readMultipart, createError, requireAuth, ApiError } from '../../lib/handler.js';
import { isImage, writeUserProfileImage, purgeFilesFromDisk } from '../../lib/storage.js';

const slotSchema = z.enum(['avatar', 'banner']);

export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event);

  const [user] = await db.select().from(users).where(eq(users.id, auth.userId)).limit(1);
  if (!user) throw createError({ statusCode: 404, message: 'User not found' });

  const { fields, files } = await readMultipart(event);

  const slotResult = slotSchema.safeParse(fields['slot']);
  if (!slotResult.success) throw new ApiError(422, 'slot must be "avatar" or "banner"');
  const slot = slotResult.data;

  const upload = files['file'];
  if (!upload) throw new ApiError(400, 'No file field in request');
  if (!isImage(upload.mimeType)) throw new ApiError(415, 'Only image types are allowed for profile images');

  const oldFileId = slot === 'avatar' ? user.avatarImageId : user.bannerImageId;
  if (oldFileId) {
    const [oldFile] = await db.select().from(storageFiles).where(eq(storageFiles.id, oldFileId)).limit(1);
    if (oldFile) {
      await purgeFilesFromDisk([oldFile]);
      await db.delete(storageFiles).where(eq(storageFiles.id, oldFileId));
    }
  }

  const [file] = await db.insert(storageFiles).values({
    userId:       user.id,
    name:         `${slot}-${upload.filename}`,
    mimeType:     upload.mimeType,
    size:         upload.data.length,
    type:         'image',
    physicalPath: '',
    hidden:       true,
  }).returning();

  const versions = await writeUserProfileImage(upload.data, user.id, slot, file.id);

  await db.insert(storageImageVersions).values(
    versions.map((v) => ({ fileId: file.id, ...v })),
  );

  const physicalPath = versions.reduce((best, v) => v.quality > best.quality ? v : best).physicalPath;
  const totalSize    = versions.reduce((sum, v) => sum + v.size, 0);

  await db.update(storageFiles)
    .set({ physicalPath, size: totalSize })
    .where(eq(storageFiles.id, file.id));

  await db.update(users)
    .set(slot === 'avatar' ? { avatarImageId: file.id } : { bannerImageId: file.id })
    .where(eq(users.id, user.id));

  return { fileId: file.id, slot, versions: versions.length };
});
