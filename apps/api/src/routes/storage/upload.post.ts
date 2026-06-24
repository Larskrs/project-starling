import z from 'zod';
import { eq } from 'drizzle-orm';
import { db, storageFolders, storageFiles, storageImageVersions } from '@starling/db';
import { defineEventHandler, readMultipart, createError, ApiError } from '../../lib/handler.js';
import { isImage, isAudio, processImage, writeAudio, imagePhysicalPath } from '../../lib/storage.js';
import { requireProductionAccess, requirePermission } from '../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const metaSchema = z.object({
  production_id: z.uuid(),
  folder_id:     z.uuid().optional(),
});

export default defineEventHandler(async (event) => {
  const { fields, files } = await readMultipart(event);

  const meta = metaSchema.safeParse(fields);
  if (!meta.success) throw new ApiError(422, 'Invalid fields', meta.error.flatten());

  const { production_id, folder_id } = meta.data;
  const upload = files['file'];
  if (!upload) throw new ApiError(400, 'No file field in request');

  const ctx = await requireProductionAccess(event, { productionId: production_id });
  await requirePermission(ctx, Permission.MANAGE_STORAGE);

  const { production } = ctx;

  if (folder_id) {
    const [folder] = await db.select({ productionId: storageFolders.productionId })
      .from(storageFolders).where(eq(storageFolders.id, folder_id)).limit(1);
    if (!folder)                               throw createError({ statusCode: 404, message: 'Folder not found' });
    if (folder.productionId !== production_id) throw createError({ statusCode: 403, message: 'Folder belongs to a different production' });
  }

  const { filename, mimeType, data } = upload;

  if (!isImage(mimeType) && !isAudio(mimeType)) {
    throw new ApiError(415, `Unsupported file type: ${mimeType}. Allowed: images and audio.`);
  }

  const type = isImage(mimeType) ? 'image' : 'audio';

  const [file] = await db.insert(storageFiles).values({
    productionId: production_id,
    folderId:     folder_id ?? null,
    name:         filename,
    mimeType,
    size:         data.length,
    type,
    physicalPath: '',
  }).returning();

  let physicalPath: string;
  let size = data.length;
  let versions: typeof storageImageVersions.$inferSelect[] = [];

  if (type === 'image') {
    const imageVersions = await processImage(
      data,
      (q) => imagePhysicalPath(production.companyId, production_id, file.id, q),
    );

    await db.insert(storageImageVersions).values(
      imageVersions.map((v) => ({ fileId: file.id, ...v })),
    );

    physicalPath = imageVersions.reduce((best, v) => v.quality > best.quality ? v : best).physicalPath;
    size = imageVersions.reduce((sum, v) => sum + v.size, 0);
    versions = await db.select().from(storageImageVersions).where(eq(storageImageVersions.fileId, file.id));
  } else {
    physicalPath = await writeAudio(data, production.companyId, production_id, file.id, mimeType);
  }

  const [updated] = await db.update(storageFiles)
    .set({ physicalPath, size })
    .where(eq(storageFiles.id, file.id))
    .returning();

  const { physicalPath: _fp, ...fileOut } = updated;
  const versionsOut = versions.map(({ physicalPath: _vp, ...v }) => v);

  return { file: fileOut, versions: type === 'image' ? versionsOut : undefined };
});
