import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, sourceSet } from '@starling/db';
import { defineEventHandler, readValidatedBody, createError } from '../../../../../../lib/handler.js';
import { requireProductionRoute } from '../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  name: z.string().min(1).max(128),
});

export default defineEventHandler(async (event) => {
  const { production, params } = await requireProductionRoute(event, {
    permission: Permission.MANAGE_TRACK_TYPES,
    params:     ['setId'],
  });
  const body = await readValidatedBody(event, bodySchema);

  const [updated] = await db.update(sourceSet)
    .set({ name: body.name, updatedAt: new Date() })
    .where(and(eq(sourceSet.id, params.setId!), eq(sourceSet.productionId, production.id)))
    .returning();

  if (!updated) throw createError({ statusCode: 404, message: 'Source set not found' });

  return updated;
});
