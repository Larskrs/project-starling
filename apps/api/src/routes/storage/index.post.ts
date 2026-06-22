import z from 'zod';
import { eq } from 'drizzle-orm';
import { db, productions, storageFolders } from '@starling/db';
import { defineEventHandler, readValidatedBody, createError, requireAuth } from '../../lib/handler.js';

const schema = z.object({
  production_id: z.uuid(),
  name:          z.string().min(1).max(200),
  parent_id:     z.uuid().optional().nullable(),
  hue:           z.number().int().min(0).max(360).optional().nullable(),
});

export default defineEventHandler(async (event) => {
  await requireAuth(event);

  const { production_id, name, parent_id, hue } = await readValidatedBody(event, schema);

  const [production] = await db.select({ id: productions.id }).from(productions).where(eq(productions.id, production_id)).limit(1);
  if (!production) throw createError({ statusCode: 404, message: 'Production not found' });

  if (parent_id) {
    const [parent] = await db.select({ id: storageFolders.id, productionId: storageFolders.productionId })
      .from(storageFolders).where(eq(storageFolders.id, parent_id)).limit(1);
    if (!parent)                               throw createError({ statusCode: 404, message: 'Parent folder not found' });
    if (parent.productionId !== production_id) throw createError({ statusCode: 403, message: 'Parent folder belongs to a different production' });
  }

  const [folder] = await db.insert(storageFolders).values({ productionId: production_id, name, parentId: parent_id, hue: hue ?? null }).returning();
  return { folder };
});
