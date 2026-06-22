import { eq } from 'drizzle-orm';
import { db, storageFiles, storageImageVersions } from '@starling/db';
import { defineEventHandler, getRouterParam, createError, requireAuth } from '../../lib/handler.js';

export default defineEventHandler(async (event) => {
  await requireAuth(event);

  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing file id' });

  const [file] = await db.select({
    id:           storageFiles.id,
    productionId: storageFiles.productionId,
    folderId:     storageFiles.folderId,
    name:         storageFiles.name,
    mimeType:     storageFiles.mimeType,
    size:         storageFiles.size,
    type:         storageFiles.type,
    createdAt:    storageFiles.createdAt,
  }).from(storageFiles).where(eq(storageFiles.id, id)).limit(1);
  if (!file) throw createError({ statusCode: 404, message: 'File not found' });

  const versions = file.type === 'image'
    ? await db.select({
        id:        storageImageVersions.id,
        fileId:    storageImageVersions.fileId,
        quality:   storageImageVersions.quality,
        size:      storageImageVersions.size,
        createdAt: storageImageVersions.createdAt,
      }).from(storageImageVersions).where(eq(storageImageVersions.fileId, id))
    : undefined;

  return { file, versions };
});
