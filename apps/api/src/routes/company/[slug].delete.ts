import { eq } from 'drizzle-orm';
import { db, companies } from '@starling/db';
import { defineEventHandler, getRouterParam, createError, requireAuth } from '../../lib/handler.js';
import { deleteCompanyStorage } from '../../lib/storage.js';

export default defineEventHandler(async (event) => {
  await requireAuth(event);

  const slug = getRouterParam(event, 'slug');
  if (!slug) throw createError({ statusCode: 400, message: 'Missing company slug' });

  const [company] = await db.select().from(companies).where(eq(companies.slug, slug)).limit(1);
  if (!company) throw createError({ statusCode: 404, message: 'Company not found' });

  const storage = await deleteCompanyStorage(company.id);

  await db.delete(companies).where(eq(companies.id, company.id));

  return { deleted: company.id, slug: company.slug, ...storage };
});
