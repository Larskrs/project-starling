import z from 'zod';
import { eq } from 'drizzle-orm';
import { db, productions } from '@starling/db';
import { defineEventHandler, readValidatedBody, createError, pickDefined } from '../../../lib/handler.js';
import { requireProductionParam } from '../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  name:             z.string().min(1).max(255).optional(),
  slug:             z.string().min(1).max(255).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens').optional(),
  allocatedStorage: z.number().int().positive().nullable().optional(),
});

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event, { permission: Permission.ADMINISTRATOR });

  const update = pickDefined(await readValidatedBody(event, bodySchema));
  if (Object.keys(update).length === 0) throw createError({ statusCode: 422, message: 'Nothing to update' });

  const [updated] = await db.update(productions)
    .set(update)
    .where(eq(productions.id, production.id))
    .returning();

  return updated;
});
