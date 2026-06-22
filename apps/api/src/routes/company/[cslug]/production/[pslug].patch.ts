import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, companies, productions } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError, requireAuth } from '../../../../lib/handler.js';

const bodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens').optional(),
});

export default defineEventHandler(async (event) => {
  await requireAuth(event);

  const cslug = getRouterParam(event, 'cslug');
  const pslug = getRouterParam(event, 'pslug');
  if (!cslug || !pslug) throw createError({ statusCode: 400, message: 'Missing slugs' });

  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.slug, cslug)).limit(1);
  if (!company) throw createError({ statusCode: 404, message: 'Company not found' });

  const [production] = await db.select()
    .from(productions)
    .where(and(eq(productions.companyId, company.id), eq(productions.slug, pslug)))
    .limit(1);
  if (!production) throw createError({ statusCode: 404, message: 'Production not found' });

  const body = await readValidatedBody(event, bodySchema);

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.slug !== undefined) update.slug = body.slug;

  if (Object.keys(update).length === 0) throw createError({ statusCode: 422, message: 'Nothing to update' });

  const [updated] = await db.update(productions)
    .set(update)
    .where(eq(productions.id, production.id))
    .returning();

  return updated;
});
