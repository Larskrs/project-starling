import { eq } from 'drizzle-orm';
import { db, storageFiles, storageImageVersions } from '@starling/db';
import { defineEventHandler, getRouterParam, createError, requireAuth } from '../../lib/handler.js';
import { removeFile } from '../../lib/storage.js';

export default defineEventHandler(async (event) => {
  await requireAuth(event);

  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing file id' });

  const [file] = await db.select().from(storageFiles).where(eq(storageFiles.id, id)).limit(1);
  if (!file) throw createError({ statusCode: 404, message: 'File not found' });

  if (file.type === 'image') {
    const versions = await db.select().from(storageImageVersions).where(eq(storageImageVersions.fileId, id));
    await Promise.all(versions.map((v) => removeFile(v.physicalPath)));
    await db.delete(storageImageVersions).where(eq(storageImageVersions.fileId, id));
  } else {
    await removeFile(file.physicalPath);
  }

  await db.delete(storageFiles).where(eq(storageFiles.id, id));

  return { deleted: id };
});
