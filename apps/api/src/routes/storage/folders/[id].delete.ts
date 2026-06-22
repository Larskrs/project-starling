import { eq } from 'drizzle-orm';
import { db, storageFolders } from '@starling/db';
import { defineEventHandler, getRouterParam, createError, requireAuth } from '../../../lib/handler.js';
import { deleteFolder } from '../../../lib/storage.js';

export default defineEventHandler(async (event) => {
  await requireAuth(event);

  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing folder id' });

  const [folder] = await db
    .select({ id: storageFolders.id })
    .from(storageFolders)
    .where(eq(storageFolders.id, id))
    .limit(1);
  if (!folder) throw createError({ statusCode: 404, message: 'Folder not found' });

  return deleteFolder(id);
});
