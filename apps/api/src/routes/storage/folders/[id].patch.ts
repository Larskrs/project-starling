import z from 'zod';
import { eq } from 'drizzle-orm';
import { db, storageFolders } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError } from '../../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const schema = z.object({
  hue:  z.number().int().min(0).max(360).nullable().optional(),
  name: z.string().min(1).max(255).optional(),
});

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing folder id' });

  const [folder] = await db.select({ id: storageFolders.id, productionId: storageFolders.productionId })
    .from(storageFolders).where(eq(storageFolders.id, id)).limit(1);
  if (!folder) throw createError({ statusCode: 404, message: 'Folder not found' });

  const ctx = await requireProductionAccess(event, { productionId: folder.productionId });
  await requirePermission(ctx, Permission.MANAGE_STORAGE);

  const body = await readValidatedBody(event, schema);
  const patch: Record<string, unknown> = {};
  if (body.hue  !== undefined) patch.hue  = body.hue;
  if (body.name !== undefined) patch.name = body.name;

  if (Object.keys(patch).length === 0) throw createError({ statusCode: 422, message: 'Nothing to update' });

  const [updated] = await db.update(storageFolders)
    .set(patch)
    .where(eq(storageFolders.id, id))
    .returning();

  return { folder: updated };
});
