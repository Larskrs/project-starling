import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, sources, sourceSet } from '@starling/db';
import { defineEventHandler, readValidatedBody, createError } from '../../../../../../../../lib/handler.js';
import { requireProductionRoute } from '../../../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  name:      z.string().min(1).max(128),
  shortName: z.string().min(1).max(16),
  hue:       z.number().int().min(0).max(360),
  data:      z.json().nullable().optional(),
});

export default defineEventHandler(async (event) => {
  const { production, params } = await requireProductionRoute(event, {
    permission: Permission.MANAGE_TRACK_TYPES,
    params:     ['setId'],
  });
  const setId = params.setId!;

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
