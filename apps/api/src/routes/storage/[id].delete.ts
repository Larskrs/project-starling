import { eq } from 'drizzle-orm';
import { db, storageFiles } from '@starling/db';
import { defineEventHandler, getRouterParam, createError, requireAuth } from '../../lib/handler.js';
import { deleteFile } from '../../lib/storage.js';

export default defineEventHandler(async (event) => {
  await requireAuth(event);

  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing file id' });

  const [file] = await db.select({ id: storageFiles.id }).from(storageFiles).where(eq(storageFiles.id, id)).limit(1);
  if (!file) throw createError({ statusCode: 404, message: 'File not found' });

  return deleteFile(id);
});
