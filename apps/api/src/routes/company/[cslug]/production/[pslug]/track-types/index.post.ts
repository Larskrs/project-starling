import z from 'zod';
import { db, trackTypes } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError } from '../../../../../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  name:        z.string().min(1).max(64),
  color:       z.string().max(32).nullable().optional(),
  trackMode: z.enum(['free', 'clip']).default('clip'),
  sourceSetId: z.string().uuid().nullable().optional(),
  sortOrder:   z.number().int().min(0).default(0),
});

export default defineEventHandler(async (event) => {
  const cslug = getRouterParam(event, 'cslug');
  const pslug = getRouterParam(event, 'pslug');
  if (!cslug || !pslug) throw createError({ statusCode: 400, message: 'Missing slugs' });

  const ctx = await requireProductionAccess(event, { cslug, pslug });
  await requirePermission(ctx, Permission.ADMINISTRATOR);

  const { production } = ctx;
  const body = await readValidatedBody(event, bodySchema);

  const [trackType] = await db.insert(trackTypes).values({
    productionId: production.id,
    name:         body.name,
    color:        body.color ?? null,
    trackMode:    body.trackMode,
    sourceSetId:  body.sourceSetId ?? null,
    sortOrder:    body.sortOrder,
  }).returning();

  return trackType!;
});
