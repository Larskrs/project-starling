import { eq, inArray } from 'drizzle-orm';
import { db, storageFolders, storageFiles, storageImageVersions } from '@starling/db';
import { defineEventHandler, getRouterParam, createError, requireAuth } from '../../../lib/handler.js';
import { removeFile } from '../../../lib/storage.js';

async function collectFolderIds(rootId: string): Promise<string[]> {
  const ids = [rootId];
  const children = await db
    .select({ id: storageFolders.id })
    .from(storageFolders)
    .where(eq(storageFolders.parentId, rootId));
  for (const child of children) {
    ids.push(...await collectFolderIds(child.id));
  }
  return ids;
}

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

  const folderIds = await collectFolderIds(id);

  const files = await db
    .select()
    .from(storageFiles)
    .where(inArray(storageFiles.folderId, folderIds));

  // Delete physical files
  await Promise.all(
    files.map(async (file) => {
      if (file.type === 'image') {
        const versions = await db
          .select()
          .from(storageImageVersions)
          .where(eq(storageImageVersions.fileId, file.id));
        await Promise.all(versions.map((v) => removeFile(v.physicalPath)));
        await db.delete(storageImageVersions).where(eq(storageImageVersions.fileId, file.id));
      } else {
        await removeFile(file.physicalPath);
      }
    }),
  );

  if (files.length) {
    await db.delete(storageFiles).where(inArray(storageFiles.id, files.map((f) => f.id)));
  }

  // Deleting the root cascades to all child folders
  await db.delete(storageFolders).where(eq(storageFolders.id, id));

  return { deleted: id, filesRemoved: files.length };
});
