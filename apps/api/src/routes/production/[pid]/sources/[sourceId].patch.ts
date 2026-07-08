import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, sources } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError, pickDefined } from '../../../../lib/handler.js';
import { requireProductionParam } from '../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  name:      z.string().min(1).max(128).optional(),
  shortName: z.string().min(1).max(16).optional(),
  hue:       z.number().int().min(0).max(360).optional(),
  data:      z.json().nullable().optional(),
});

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event, { permission: Permission.MANAGE_TRACK_TYPES });
  const sourceId = getRouterParam(event, 'sourceId')!;

  const update = pickDefined(await readValidatedBody(event, bodySchema));

  const [updated] = await db.update(sources)
    .set({ ...update, updatedAt: new Date() })
    .where(and(eq(sources.id, sourceId), eq(sources.productionId, production.id)))
    .returning();

  if (!updated) throw createError({ statusCode: 404, message: 'Source not found' });

  return updated;
});
