import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, sources } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError } from '../../../../../../../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  name:      z.string().min(1).max(128).optional(),
  shortName: z.string().min(1).max(16).optional(),
  hue:       z.number().int().min(0).max(360).optional(),
  data:      z.json().nullable().optional(),
});

export default defineEventHandler(async (event) => {
  const cslug    = getRouterParam(event, 'cslug');
  const pslug    = getRouterParam(event, 'pslug');
  const setId    = getRouterParam(event, 'setId');
  const sourceId = getRouterParam(event, 'sourceId');
  if (!cslug || !pslug || !setId || !sourceId) throw createError({ statusCode: 400, message: 'Missing params' });

  const ctx = await requireProductionAccess(event, { cslug, pslug });
  await requirePermission(ctx, Permission.ADMINISTRATOR);

  const { production } = ctx;
  const body = await readValidatedBody(event, bodySchema);

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name      !== undefined) update.name      = body.name;
  if (body.shortName !== undefined) update.shortName = body.shortName;
  if (body.hue       !== undefined) update.hue       = body.hue;
  if (body.data      !== undefined) update.data      = body.data;

  const [updated] = await db.update(sources)
    .set(update)
    .where(and(
      eq(sources.id, sourceId),
      eq(sources.sourceSetId, setId),
      eq(sources.productionId, production.id),
    ))
    .returning();

  if (!updated) throw createError({ statusCode: 404, message: 'Source not found' });

  return updated;
});
