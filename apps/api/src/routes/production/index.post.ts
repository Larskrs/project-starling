import { z } from 'zod';
import { and, eq, or } from 'drizzle-orm';
import { productions, productionMembers, companies, companyMembers, db } from '@starling/db';
import { defineEventHandler, readValidatedBody, ApiError, createError, requireAuth } from '../../lib/handler.js';

const schema = z.object({
  company_id: z.uuid(),
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers, and hyphens'),
});

export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event);

  const { company_id, name, slug } = await readValidatedBody(event, schema);

  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, company_id)).limit(1);
  if (!company) throw createError({ statusCode: 404, message: 'Company not found' });

  if (auth.role !== 'admin') {
    const [mem] = await db
      .select({ id: companyMembers.id })
      .from(companyMembers)
      .where(and(
        eq(companyMembers.companyId, company_id),
        eq(companyMembers.userId, auth.userId),
        or(eq(companyMembers.role, 'owner'), eq(companyMembers.role, 'admin')),
      ))
      .limit(1);
    if (!mem) throw new ApiError(403, 'Only company admins or owners can create productions');
  }

  const [existing] = await db.select({ id: productions.id }).from(productions)
    .where(and(eq(productions.companyId, company_id), eq(productions.slug, slug)))
    .limit(1);
  if (existing) throw new ApiError(409, 'A production with that slug already exists in this company');

  const [production] = await db.insert(productions).values({ companyId: company_id, name, slug }).returning();
  await db.insert(productionMembers).values({ productionId: production.id, userId: auth.userId });
  return { production };
});
