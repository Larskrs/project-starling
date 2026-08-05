import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, sourceSet } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError, pickDefined } from '../../../../lib/handler.js';
import { requireProductionParam } from '../../../../lib/production.js';
import { iconField } from '../../../../lib/icons.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  name: z.string().min(1).max(128).optional(),
  icon: iconField,
});

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event, { permission: Permission.MANAGE_TRACK_TYPES });
  const setId = getRouterParam(event, 'setId')!;

  const update = pickDefined(await readValidatedBody(event, bodySchema));
  if (Object.keys(update).length === 0) throw createError({ statusCode: 422, message: 'Nothing to update' });

  const [updated] = await db.update(sourceSet)
    .set({ ...update, updatedAt: new Date() })
    .where(and(eq(sourceSet.id, setId), eq(sourceSet.productionId, production.id)))
    .returning();

  if (!updated) throw createError({ statusCode: 404, message: 'Source set not found' });

  return updated;
});
