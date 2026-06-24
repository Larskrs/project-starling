import z from 'zod';
import { eq } from 'drizzle-orm';
import { db, storageFolders } from '@starling/db';
import { defineEventHandler, readValidatedBody, createError } from '../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const schema = z.object({
  production_id: z.uuid(),
  name:          z.string().min(1).max(200),
  parent_id:     z.uuid().optional().nullable(),
  hue:           z.number().int().min(0).max(360).optional().nullable(),
});

export default defineEventHandler(async (event) => {
  const { production_id, name, parent_id, hue } = await readValidatedBody(event, schema);

  const ctx = await requireProductionAccess(event, { productionId: production_id });
  await requirePermission(ctx, Permission.MANAGE_STORAGE);

  if (parent_id) {
    const [parent] = await db.select({ id: storageFolders.id, productionId: storageFolders.productionId })
      .from(storageFolders).where(eq(storageFolders.id, parent_id)).limit(1);
    if (!parent)                                    throw createError({ statusCode: 404, message: 'Parent folder not found' });
    if (parent.productionId !== production_id)      throw createError({ statusCode: 403, message: 'Parent folder belongs to a different production' });
  }

  const [folder] = await db.insert(storageFolders).values({ productionId: production_id, name, parentId: parent_id, hue: hue ?? null }).returning();
  return { folder };
});
