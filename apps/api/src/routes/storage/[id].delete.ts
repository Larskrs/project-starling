import { eq } from 'drizzle-orm';
import { db, storageFiles } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../lib/handler.js';
import { deleteFile } from '../../lib/storage.js';
import { requireProductionAccess, requirePermission } from '../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing file id' });

  const [file] = await db.select({
    id:           storageFiles.id,
    productionId: storageFiles.productionId,
  }).from(storageFiles).where(eq(storageFiles.id, id)).limit(1);
  if (!file) throw createError({ statusCode: 404, message: 'File not found' });

  const ctx = await requireProductionAccess(event, { productionId: file.productionId });
  await requirePermission(ctx, Permission.MANAGE_STORAGE);

  return deleteFile(id);
});
