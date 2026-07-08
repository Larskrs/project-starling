import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, sources, sourceSet } from '@starling/db';
import { defineEventHandler, getValidatedQuery, readValidatedBody, createError } from '../../../../lib/handler.js';
import { requireProductionParam } from '../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const querySchema = z.object({
  sid: z.uuid(),
});

const bodySchema = z.object({
  name:      z.string().min(1).max(128),
  shortName: z.string().min(1).max(16),
  hue:       z.number().int().min(0).max(360),
  data:      z.json().nullable().optional(),
});

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event, { permission: Permission.MANAGE_TRACK_TYPES });
  const { sid } = getValidatedQuery(event, querySchema);

  const [set] = await db.select({ id: sourceSet.id }).from(sourceSet)
    .where(and(eq(sourceSet.id, sid), eq(sourceSet.productionId, production.id)))
    .limit(1);
  if (!set) throw createError({ statusCode: 404, message: 'Source set not found' });

  const body = await readValidatedBody(event, bodySchema);

  const [source] = await db.insert(sources).values({
    productionId: production.id,
    sourceSetId:  sid,
    name:         body.name,
    shortName:    body.shortName,
    hue:          body.hue,
    data:         body.data ?? null,
  }).returning();

  return source!;
});
