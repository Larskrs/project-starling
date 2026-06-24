import { eq } from 'drizzle-orm';
import { db, storageFolders } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../lib/handler.js';
import { deleteFolder } from '../../../lib/storage.js';
import { requireProductionAccess, requirePermission } from '../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing folder id' });

  const [folder] = await db.select({ id: storageFolders.id, productionId: storageFolders.productionId })
    .from(storageFolders)
    .where(eq(storageFolders.id, id))
    .limit(1);
  if (!folder) throw createError({ statusCode: 404, message: 'Folder not found' });

  const ctx = await requireProductionAccess(event, { productionId: folder.productionId });
  await requirePermission(ctx, Permission.MANAGE_STORAGE);

  return deleteFolder(id);
});
