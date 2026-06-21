import z from 'zod';
import { eq, and, isNull, getTableColumns } from 'drizzle-orm';
import { db, storageFiles, storageFolders, storageImageVersions } from '@starling/db';
import { defineEventHandler, getValidatedQuery, requireAuth } from '../../lib/handler.js';
import { createError } from '../../lib/handler.js';
import { companies } from '@starling/db';

const querySchema = z.object({
  cid:       z.uuid(),
  folder_id: z.uuid().optional(),
});

export default defineEventHandler(async (event) => {
  await requireAuth(event);

  const { cid, folder_id } = getValidatedQuery(event, querySchema);

  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, cid)).limit(1);
  if (!company) throw createError({ statusCode: 404, message: 'Company not found' });

  const folderFilter = folder_id
    ? eq(storageFolders.parentId, folder_id)
    : isNull(storageFolders.parentId);

  const [directFolders, allFolderIndex, allFileIndex, files] = await Promise.all([
    // Direct child folders (for rendering)
    db.select(getTableColumns(storageFolders))
      .from(storageFolders)
      .where(and(eq(storageFolders.companyId, cid), folderFilter))
      .orderBy(storageFolders.name),

    // All company folders → parent→children map for recursive counting
    db.select({ id: storageFolders.id, parentId: storageFolders.parentId })
      .from(storageFolders)
      .where(eq(storageFolders.companyId, cid)),

    // All company files → folder→count map for recursive counting
    db.select({ id: storageFiles.id, folderId: storageFiles.folderId })
      .from(storageFiles)
      .where(eq(storageFiles.companyId, cid)),

    // FILES in current folder (for rendering)
    db.select({
      id:        storageFiles.id,
      companyId: storageFiles.companyId,
      folderId:  storageFiles.folderId,
      name:      storageFiles.name,
      mimeType:  storageFiles.mimeType,
      size:      storageFiles.size,
      type:      storageFiles.type,
      createdAt: storageFiles.createdAt,
    }).from(storageFiles)
      .where(
        and(
          eq(storageFiles.companyId, cid),
          folder_id ? eq(storageFiles.folderId, folder_id) : isNull(storageFiles.folderId),
        ),
      ),
  ]);

  // Build in-memory indices for O(n) recursive counting
  const childrenOf = new Map<string, string[]>();
  for (const f of allFolderIndex) {
    if (!f.parentId) continue;
    if (!childrenOf.has(f.parentId)) childrenOf.set(f.parentId, []);
    childrenOf.get(f.parentId)!.push(f.id);
  }

  const directFileCount = new Map<string, number>();
  for (const f of allFileIndex) {
    if (!f.folderId) continue;
    directFileCount.set(f.folderId, (directFileCount.get(f.folderId) ?? 0) + 1);
  }

  function recursiveCounts(id: string): { fileCount: number; folderCount: number } {
    const children = childrenOf.get(id) ?? [];
    let fileCount   = directFileCount.get(id) ?? 0;
    let folderCount = children.length;
    for (const childId of children) {
      const sub = recursiveCounts(childId);
      fileCount   += sub.fileCount;
      folderCount += sub.folderCount;
    }
    return { fileCount, folderCount };
  }

  const folders = directFolders.map((folder) => ({ ...folder, ...recursiveCounts(folder.id) }));

  const imageVersions = await Promise.all(
    files
      .filter((f) => f.type === 'image')
      .map((f) =>
        db.select({
          id:        storageImageVersions.id,
          fileId:    storageImageVersions.fileId,
          quality:   storageImageVersions.quality,
          size:      storageImageVersions.size,
          createdAt: storageImageVersions.createdAt,
        }).from(storageImageVersions).where(eq(storageImageVersions.fileId, f.id))
          .then((versions) => ({ fileId: f.id, versions })),
      ),
  );

  const versionMap = Object.fromEntries(imageVersions.map((v) => [v.fileId, v.versions]));

  return {
    folders,
    files: files.map((f) => ({
      ...f,
      versions: f.type === 'image' ? (versionMap[f.id] ?? []) : undefined,
    })),
  };
});
