import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, trackTypes } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError } from '../../../../../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  name:        z.string().min(1).max(64).optional(),
  color:       z.string().max(32).nullable().optional(),
  trackMode: z.enum(['free', 'clip']).optional(),
  sourceSetId: z.string().uuid().nullable().optional(),
  sortOrder:   z.number().int().min(0).optional(),
});

export default defineEventHandler(async (event) => {
  const cslug  = getRouterParam(event, 'cslug');
  const pslug  = getRouterParam(event, 'pslug');
  const typeId = getRouterParam(event, 'typeId');
  if (!cslug || !pslug || !typeId) throw createError({ statusCode: 400, message: 'Missing params' });

  const ctx = await requireProductionAccess(event, { cslug, pslug });
  await requirePermission(ctx, Permission.ADMINISTRATOR);

  const { production } = ctx;
  const body = await readValidatedBody(event, bodySchema);

  const update: Record<string, unknown> = {};
  if (body.name        !== undefined) update.name        = body.name;
  if (body.color       !== undefined) update.color       = body.color;
  if (body.trackMode   !== undefined) update.trackMode   = body.trackMode;
  if (body.sourceSetId !== undefined) update.sourceSetId = body.sourceSetId;
  if (body.sortOrder   !== undefined) update.sortOrder   = body.sortOrder;

  if (Object.keys(update).length === 0) throw createError({ statusCode: 422, message: 'Nothing to update' });

  const [updated] = await db.update(trackTypes)
    .set(update)
    .where(and(eq(trackTypes.id, typeId), eq(trackTypes.productionId, production.id)))
    .returning();

  if (!updated) throw createError({ statusCode: 404, message: 'Track type not found' });

  return updated;
});
