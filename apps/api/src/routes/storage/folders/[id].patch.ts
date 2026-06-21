import z from 'zod';
import { eq } from 'drizzle-orm';
import { db, storageFolders } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError, requireAuth } from '../../../lib/handler.js';

const schema = z.object({
  hue:  z.number().int().min(0).max(360).nullable().optional(),
  name: z.string().min(1).max(255).optional(),
});

export default defineEventHandler(async (event) => {
  await requireAuth(event);

  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing folder id' });

  const [existing] = await db.select({ id: storageFolders.id })
    .from(storageFolders).where(eq(storageFolders.id, id)).limit(1);
  if (!existing) throw createError({ statusCode: 404, message: 'Folder not found' });

  const body = await readValidatedBody(event, schema);
  const patch: Record<string, unknown> = {};
  if (body.hue  !== undefined) patch.hue  = body.hue;
  if (body.name !== undefined) patch.name = body.name;

  const [folder] = await db.update(storageFolders)
    .set(patch)
    .where(eq(storageFolders.id, id))
    .returning();

  return { folder };
});
