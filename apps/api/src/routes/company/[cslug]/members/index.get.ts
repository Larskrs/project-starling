import { eq, and, or } from 'drizzle-orm';
import { db, companies, companyMembers, users } from '@starling/db';
import { defineEventHandler, getRouterParam, createError, requireAuth, ApiError } from '../../../../lib/handler.js';

export default defineEventHandler(async (event) => {
  const cslug = getRouterParam(event, 'cslug');
  if (!cslug) throw createError({ statusCode: 400, message: 'Missing company slug' });

  const auth = await requireAuth(event);

  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.slug, cslug)).limit(1);
  if (!company) throw createError({ statusCode: 404, message: 'Company not found' });

  if (auth.role !== 'admin') {
    const [mem] = await db
      .select({ id: companyMembers.id })
      .from(companyMembers)
      .where(and(
        eq(companyMembers.companyId, company.id),
        eq(companyMembers.userId, auth.userId),
        or(eq(companyMembers.role, 'owner'), eq(companyMembers.role, 'admin')),
      ))
      .limit(1);
    if (!mem) throw new ApiError(403, 'Company admin access required');
  }

  const members = await db
    .select({
      id:         companyMembers.id,
      role:       companyMembers.role,
      userId:     companyMembers.userId,
      email:      users.email,
      first_name: users.first_name,
      last_name:  users.last_name,
    })
    .from(companyMembers)
    .leftJoin(users, eq(companyMembers.userId, users.id))
    .where(eq(companyMembers.companyId, company.id));

  return { members };
});
