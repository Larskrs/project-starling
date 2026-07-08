import { eq } from 'drizzle-orm';
import { db, companies } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../lib/handler.js';
import { requireCompanyAdmin } from '../../lib/company.js';
import { deleteCompanyStorage } from '../../lib/storage.js';

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug');
  if (!slug) throw createError({ statusCode: 400, message: 'Missing company slug' });

  const { company } = await requireCompanyAdmin(event, { slug });

  const storage = await deleteCompanyStorage(company.id);

  await db.delete(companies).where(eq(companies.id, company.id));

  return { deleted: company.id, slug: company.slug, ...storage };
});
