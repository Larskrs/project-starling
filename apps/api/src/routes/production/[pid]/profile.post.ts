import z from 'zod';
import { eq } from 'drizzle-orm';
import { db, productions, storageFiles, storageImageVersions } from '@starling/db';
import { defineEventHandler, readMultipart, ApiError } from '../../../lib/handler.js';
import { isImage, writeProfileImage, purgeFilesFromDisk } from '../../../lib/storage.js';
import { requireProductionParam } from '../../../lib/production.js';

const slotSchema = z.enum(['profile', 'banner']);

export default defineEventHandler(async (event) => {
  const { company, production } = await requireProductionParam(event);

  const { fields, files } = await readMultipart(event);

  const slotResult = slotSchema.safeParse(fields['slot']);
  if (!slotResult.success) throw new ApiError(422, 'slot must be "profile" or "banner"');
  const slot = slotResult.data;

  const upload = files['file'];
  if (!upload) throw new ApiError(400, 'No file field in request');
  if (!isImage(upload.mimeType)) throw new ApiError(415, `Only image types are allowed for profile images`);

  const oldFileId = slot === 'profile' ? production.profileImageId : production.bannerImageId;
  if (oldFileId) {
    const [oldFile] = await db.select().from(storageFiles).where(eq(storageFiles.id, oldFileId)).limit(1);
    if (oldFile) {
      await purgeFilesFromDisk([oldFile]);
      await db.delete(storageFiles).where(eq(storageFiles.id, oldFileId));
    }
  }

  const [file] = await db.insert(storageFiles).values({
    productionId: production.id,
    folderId:     null,
    name:         `${slot}-${upload.filename}`,
    mimeType:     upload.mimeType,
    size:         upload.data.length,
    type:         'image',
    physicalPath: '',
    hidden:       true,
  }).returning();

  const versions = await writeProfileImage(upload.data, company.id, production.id, slot, file.id);

  await db.insert(storageImageVersions).values(
    versions.map((v) => ({ fileId: file.id, ...v })),
  );

  const physicalPath = versions.reduce((best, v) => v.quality > best.quality ? v : best).physicalPath;
  const totalSize    = versions.reduce((sum, v) => sum + v.size, 0);

  await db.update(storageFiles)
    .set({ physicalPath, size: totalSize })
    .where(eq(storageFiles.id, file.id));

  await db.update(productions)
    .set(slot === 'profile' ? { profileImageId: file.id } : { bannerImageId: file.id })
    .where(eq(productions.id, production.id));

  return { fileId: file.id, slot, versions: versions.length };
});
