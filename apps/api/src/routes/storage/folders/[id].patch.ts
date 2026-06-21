import z from 'zod';
import { eq } from 'drizzle-orm';
import { db, storageFolders } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError, requireAuth } from '../../../lib/handler.js';

const schema = z.object({
  hue: z.number().int().min(0).max(360).nullable(),
});

export default defineEventHandler(async (event) => {
  await requireAuth(event);

  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing folder id' });

  const [existing] = await db.select({ id: storageFolders.id })
    .from(storageFolders).where(eq(storageFolders.id, id)).limit(1);
  if (!existing) throw createError({ statusCode: 404, message: 'Folder not found' });

  const { hue } = await readValidatedBody(event, schema);

  const [folder] = await db.update(storageFolders)
    .set({ hue })
    .where(eq(storageFolders.id, id))
    .returning();

  return { folder };
});
