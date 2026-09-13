import { eq, and, isNull } from 'drizzle-orm';
import { db, apiTokens, storageFiles, storageImageVersions } from '@starling/db';
import { defineEventHandler, getRouterParam, readMultipart, createError, ApiError } from '../../../../../lib/handler.js';
import { requireProductionParam } from '../../../../../lib/production.js';
import { isImage, processImage, tokenProfileImagePath, purgeFilesFromDisk } from '../../../../../lib/storage.js';
import { invalidateToken } from '../../../../../lib/apiTokens.js';
import { Permission } from '@starling/auth/permissions';

/**
 * A token's profile image — the same flow as the timeline profile route
 * (replace the old file, fan out quality versions, point the row at the new
 * file). One image per token, no banner.
 *
 * It is what the device shows as in presence, so the cached token row is
 * dropped: the next connection picks the new image up instead of the old one.
 */
export default defineEventHandler(async (event) => {
  const { company, production } = await requireProductionParam(event, { permission: Permission.ADMINISTRATOR });
  const tokenId = getRouterParam(event, 'tokenId')!;

  // Scoped by production as well as id, like revoking.
  const [token] = await db.select().from(apiTokens)
    .where(and(
      eq(apiTokens.id, tokenId),
      eq(apiTokens.productionId, production.id),
      isNull(apiTokens.revokedAt),
    ))
    .limit(1);
  if (!token) throw createError({ statusCode: 404, message: 'Token not found', errorKey: 'errors.token.notFound' });

  const { files } = await readMultipart(event);

  const upload = files['file'];
  if (!upload) throw new ApiError(400, 'No file field in request');
  if (!isImage(upload.mimeType)) throw new ApiError(415, 'Only image types are allowed for profile images');

  if (token.profileImageId) {
    const [oldFile] = await db.select().from(storageFiles).where(eq(storageFiles.id, token.profileImageId)).limit(1);
    if (oldFile) {
      await purgeFilesFromDisk([oldFile]);
      await db.delete(storageFiles).where(eq(storageFiles.id, oldFile.id));
    }
  }

  // productionId is set so the production's storage teardown sweeps this up.
  const [file] = await db.insert(storageFiles).values({
    productionId: production.id,
    folderId:     null,
    name:         `token-profile-${upload.filename}`,
    mimeType:     upload.mimeType,
    size:         upload.data.length,
    type:         'image',
    physicalPath: '',
    hidden:       true,
  }).returning();

  const versions = await processImage(upload.data, (q) => tokenProfileImagePath(company.id, production.id, token.id, file.id, q));

  await db.insert(storageImageVersions).values(
    versions.map((v) => ({ fileId: file.id, ...v })),
  );

  const physicalPath = versions.reduce((best, v) => v.quality > best.quality ? v : best).physicalPath;
  const totalSize    = versions.reduce((sum, v) => sum + v.size, 0);

  await db.update(storageFiles)
    .set({ physicalPath, size: totalSize })
    .where(eq(storageFiles.id, file.id));

  await db.update(apiTokens)
    .set({ profileImageId: file.id })
    .where(eq(apiTokens.id, token.id));

  invalidateToken(token.id);

  return { fileId: file.id, versions: versions.length };
});
