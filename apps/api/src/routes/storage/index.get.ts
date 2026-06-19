import z from 'zod';
import { eq, and, isNull } from 'drizzle-orm';
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

  const [folders, files] = await Promise.all([
    db.select().from(storageFolders).where(
      and(eq(storageFolders.companyId, cid), folderFilter),
    ),
    db.select().from(storageFiles).where(
      and(
        eq(storageFiles.companyId, cid),
        folder_id ? eq(storageFiles.folderId, folder_id) : isNull(storageFiles.folderId),
      ),
    ),
  ]);

  const imageVersions = await Promise.all(
    files
      .filter((f) => f.type === 'image')
      .map((f) =>
        db.select().from(storageImageVersions).where(eq(storageImageVersions.fileId, f.id))
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
