import { eq } from 'drizzle-orm';
import z from 'zod';
import { db, storageFiles } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError } from '../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  folder_id: z.string().uuid().nullable().optional(),
  name:      z.string().min(1).max(255).optional(),
});

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing file id' });

  const [file] = await db.select({
    id:           storageFiles.id,
    productionId: storageFiles.productionId,
  }).from(storageFiles).where(eq(storageFiles.id, id)).limit(1);
  if (!file) throw createError({ statusCode: 404, message: 'File not found' });
  if (!file.productionId) throw createError({ statusCode: 404, message: 'File not found' });

  const ctx = await requireProductionAccess(event, { productionId: file.productionId });
  await requirePermission(ctx, Permission.MANAGE_STORAGE);

  const body = await readValidatedBody(event, bodySchema);

  const update: Record<string, unknown> = {};
  if (body.folder_id !== undefined) update.folderId = body.folder_id;
  if (body.name      !== undefined) update.name     = body.name;

  if (Object.keys(update).length === 0) throw createError({ statusCode: 422, message: 'Nothing to update' });

  await db.update(storageFiles).set(update).where(eq(storageFiles.id, id));

  return { id, ...update };
});
