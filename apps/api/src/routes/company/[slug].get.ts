import { eq, and, or } from 'drizzle-orm';
import { db, companies, companyMembers } from '@starling/db';
import { createError, defineEventHandler, getRouterParam, getAuth } from '../../lib/handler.js';

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug');
  if (!slug) throw createError({ statusCode: 404, message: 'Company not found' });

  const auth = await getAuth(event);
  if (!auth) throw createError({ statusCode: 401, message: 'Authentication required' });

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

  return { ...company, canManage };
});
