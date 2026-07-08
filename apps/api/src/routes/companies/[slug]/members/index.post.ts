import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, companies, companyMembers, users } from '@starling/db';
import { defineEventHandler, getRouterParam, readValidatedBody, createError, requireAdmin, ApiError } from '../../../../lib/handler.js';

const schema = z.object({
  email: z.string().email(),
  role:  z.enum(['admin', 'member']),
});

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug');
  if (!slug) throw createError({ statusCode: 400, message: 'Missing company slug' });

  await requireAdmin(event);

  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.slug, slug)).limit(1);
  if (!company) throw createError({ statusCode: 404, message: 'Company not found' });

  const { email, role } = await readValidatedBody(event, schema);

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw new ApiError(404, 'No user found with that email address');

  const [existing] = await db
    .select({ id: companyMembers.id, role: companyMembers.role })
    .from(companyMembers)
    .where(and(eq(companyMembers.companyId, company.id), eq(companyMembers.userId, user.id)))
    .limit(1);

  if (existing) {
    if (existing.role === 'owner') throw new ApiError(409, 'Cannot change the role of the company owner');
    const [updated] = await db
      .update(companyMembers)
      .set({ role })
      .where(eq(companyMembers.id, existing.id))
      .returning();
    return { member: updated };
  }

  const [member] = await db
    .insert(companyMembers)
    .values({ companyId: company.id, userId: user.id, role })
    .returning();

  return { member };
});
