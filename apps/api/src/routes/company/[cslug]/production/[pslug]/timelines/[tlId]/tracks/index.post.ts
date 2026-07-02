import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, timelines, tracks, trackTypes } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError } from '../../../../../../../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  typeId:    z.string().uuid(),
  name:      z.string().min(1).max(128),
  sourceId:  z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export default defineEventHandler(async (event) => {
  const cslug = getRouterParam(event, 'cslug');
  const pslug = getRouterParam(event, 'pslug');
  const tlId  = getRouterParam(event, 'tlId');
  if (!cslug || !pslug || !tlId) throw createError({ statusCode: 400, message: 'Missing params' });

  const ctx = await requireProductionAccess(event, { cslug, pslug });
  await requirePermission(ctx, Permission.EDIT_TIMELINE);

  const { production } = ctx;

  const [timeline] = await db.select().from(timelines)
    .where(and(eq(timelines.id, tlId), eq(timelines.productionId, production.id)))
    .limit(1);
  if (!timeline) throw createError({ statusCode: 404, message: 'Timeline not found' });

  const body = await readValidatedBody(event, bodySchema);

  const [trackType] = await db.select().from(trackTypes)
    .where(and(eq(trackTypes.id, body.typeId), eq(trackTypes.productionId, production.id)))
    .limit(1);
  if (!trackType) throw createError({ statusCode: 404, message: 'Track type not found' });

  const [track] = await db.insert(tracks).values({
    timelineId: tlId,
    typeId:     body.typeId,
    name:       body.name,
    mode:       trackType.trackMode,
    sourceId:   body.sourceId ?? null,
    sortOrder:  body.sortOrder ?? 0,
  }).returning();

  return track!;
});
