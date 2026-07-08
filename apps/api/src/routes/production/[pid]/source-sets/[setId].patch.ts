import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, sourceSet } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError } from '../../../../lib/handler.js';
import { requireProductionParam } from '../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  name: z.string().min(1).max(128),
});

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event, { permission: Permission.MANAGE_TRACK_TYPES });
  const setId = getRouterParam(event, 'setId')!;
  const body = await readValidatedBody(event, bodySchema);

  const [updated] = await db.update(sourceSet)
    .set({ name: body.name, updatedAt: new Date() })
    .where(and(eq(sourceSet.id, setId), eq(sourceSet.productionId, production.id)))
    .returning();

  if (!updated) throw createError({ statusCode: 404, message: 'Source set not found' });

  return updated;
});
