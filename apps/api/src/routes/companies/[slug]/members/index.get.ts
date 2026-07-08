import { eq } from 'drizzle-orm';
import { db, companyMembers, users } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../../lib/handler.js';
import { requireCompanyAdmin } from '../../../../lib/company.js';

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug');
  if (!slug) throw createError({ statusCode: 400, message: 'Missing company slug' });

  const { company } = await requireCompanyAdmin(event, { slug });

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
