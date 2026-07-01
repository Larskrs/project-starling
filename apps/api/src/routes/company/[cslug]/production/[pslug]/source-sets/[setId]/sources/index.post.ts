import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, sources, sourceSet } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError } from '../../../../../../../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  name:      z.string().min(1).max(128),
  shortName: z.string().min(1).max(16),
  hue:       z.number().int().min(0).max(360),
  data:      z.json().nullable().optional(),
});

export default defineEventHandler(async (event) => {
  const cslug = getRouterParam(event, 'cslug');
  const pslug = getRouterParam(event, 'pslug');
  const setId = getRouterParam(event, 'setId');
  if (!cslug || !pslug || !setId) throw createError({ statusCode: 400, message: 'Missing params' });

  const ctx = await requireProductionAccess(event, { cslug, pslug });
  await requirePermission(ctx, Permission.ADMINISTRATOR);

  const { production } = ctx;

  const [set] = await db.select().from(sourceSet)
    .where(and(eq(sourceSet.id, setId), eq(sourceSet.productionId, production.id)));
  if (!set) throw createError({ statusCode: 404, message: 'Source set not found' });

  const body = await readValidatedBody(event, bodySchema);

  const [source] = await db.insert(sources).values({
    productionId: production.id,
    sourceSetId:  setId,
    name:         body.name,
    shortName:    body.shortName,
    hue:          body.hue,
    data:         body.data ?? null,
  }).returning();

  return source!;
});
