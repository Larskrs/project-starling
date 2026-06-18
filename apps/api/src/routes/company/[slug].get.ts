import { db, companies } from '@starling/db';
import { eq } from 'drizzle-orm';
import { createError, defineEventHandler, getRouterParam, requireAuth } from '../../lib/handler.js';

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug');
  if (!slug) throw createError({ statusCode: 404, message: 'Company not found' });

  await requireAuth(event);

  const company = await db.select().from(companies).where(eq(companies.slug, slug));
  if (!company || company.length === 0) throw createError({ statusCode: 404, message: 'Company not found' });
  
  return company[0];
});
