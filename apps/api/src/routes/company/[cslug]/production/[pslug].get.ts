import { db, companies, productions } from '@starling/db';
import { eq, and } from 'drizzle-orm';
import { createError, defineEventHandler, getRouterParam, requireAuth } from '../../../../lib/handler.js';

export default defineEventHandler(async (event) => {
  await requireAuth(event);

  const cslug = getRouterParam(event, 'cslug');
  const pslug = getRouterParam(event, 'pslug');
  if (!cslug || !pslug) throw createError({ statusCode: 400, message: 'Missing slugs' });

  const [company] = await db.select().from(companies).where(eq(companies.slug, cslug)).limit(1);
  if (!company) throw createError({ statusCode: 404, message: 'Company not found' });

  const [production] = await db.select().from(productions)
    .where(and(eq(productions.companyId, company.id), eq(productions.slug, pslug)))
    .limit(1);
  if (!production) throw createError({ statusCode: 404, message: 'Production not found' });

  return { company, production };
});
