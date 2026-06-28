import z from 'zod';
import { eq, and, ne, or } from 'drizzle-orm';
import { db, companies, companyMembers } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError, requireAuth } from '../../lib/handler.js';

const bodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z.string().min(1).max(255).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens').optional(),
});

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug');
  if (!slug) throw createError({ statusCode: 400, message: 'Missing company slug' });

  const auth = await requireAuth(event);

  const [company] = await db.select().from(companies).where(eq(companies.slug, slug)).limit(1);
  if (!company) throw createError({ statusCode: 404, message: 'Company not found' });

  let canManage = auth.role === 'admin';
  if (!canManage) {
    const [mem] = await db
      .select({ id: companyMembers.id })
      .from(companyMembers)
      .where(and(
        eq(companyMembers.companyId, company.id),
        eq(companyMembers.userId, auth.userId),
        or(eq(companyMembers.role, 'owner'), eq(companyMembers.role, 'admin')),
      ))
      .limit(1);
    canManage = !!mem;
  }
  if (!canManage) throw createError({ statusCode: 403, message: 'Access denied' });

  const body = await readValidatedBody(event, bodySchema);

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.slug !== undefined) update.slug = body.slug;

  if (Object.keys(update).length === 0) throw createError({ statusCode: 422, message: 'Nothing to update' });

  if (body.slug) {
    const [conflict] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.slug, body.slug), ne(companies.id, company.id)))
      .limit(1);
    if (conflict) throw createError({ statusCode: 409, message: 'Slug already taken' });
  }

  const [updated] = await db.update(companies).set(update).where(eq(companies.id, company.id)).returning();
  return updated;
});
