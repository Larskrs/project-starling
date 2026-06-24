import z from 'zod';
import { eq, and, isNull, ne, getTableColumns } from 'drizzle-orm';
import { db, storageFiles, storageFolders, storageImageVersions } from '@starling/db';
import { defineEventHandler, getValidatedQuery } from '../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const querySchema = z.object({
  pid:       z.uuid(),
  folder_id: z.uuid().optional(),
});

export default defineEventHandler(async (event) => {
  const { pid, folder_id } = getValidatedQuery(event, querySchema);

  const ctx = await requireProductionAccess(event, { productionId: pid });
  await requirePermission(ctx, Permission.VIEW);

  const { production } = ctx;

  const folderFilter = folder_id
    ? eq(storageFolders.parentId, folder_id)
    : isNull(storageFolders.parentId);

  const [directFolders, allFolderIndex, allFileIndex, files] = await Promise.all([
    db.select(getTableColumns(storageFolders))
      .from(storageFolders)
      .where(and(eq(storageFolders.productionId, production.id), folderFilter))
      .orderBy(storageFolders.name),

    db.select({ id: storageFolders.id, parentId: storageFolders.parentId })
      .from(storageFolders)
      .where(eq(storageFolders.productionId, production.id)),

    db.select({ id: storageFiles.id, folderId: storageFiles.folderId })
      .from(storageFiles)
      .where(and(eq(storageFiles.productionId, production.id), ne(storageFiles.hidden, true))),

    db.select({
      id:           storageFiles.id,
      productionId: storageFiles.productionId,
      folderId:     storageFiles.folderId,
      name:         storageFiles.name,
      mimeType:     storageFiles.mimeType,
      size:         storageFiles.size,
      type:         storageFiles.type,
      createdAt:    storageFiles.createdAt,
    }).from(storageFiles)
      .where(
        and(
          eq(storageFiles.productionId, production.id),
          ne(storageFiles.hidden, true),
          folder_id ? eq(storageFiles.folderId, folder_id) : isNull(storageFiles.folderId),
        ),
      ),
  ]);

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
