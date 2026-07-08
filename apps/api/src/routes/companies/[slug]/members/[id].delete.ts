import { eq, and } from 'drizzle-orm';
import { db, companies, companyMembers } from '@starling/db';
import { defineEventHandler, getRouterParam, createError, requireAdmin, ApiError } from '../../../../lib/handler.js';

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug');
  const id   = getRouterParam(event, 'id');
  if (!slug) throw createError({ statusCode: 400, message: 'Missing company slug' });
  if (!id)   throw createError({ statusCode: 400, message: 'Missing member id' });

  await requireAdmin(event);

  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.slug, slug)).limit(1);
  if (!company) throw createError({ statusCode: 404, message: 'Company not found' });

  const [mem] = await db
    .select({ id: companyMembers.id, role: companyMembers.role })
    .from(companyMembers)
    .where(and(eq(companyMembers.id, id), eq(companyMembers.companyId, company.id)))
    .limit(1);
  if (!mem) throw createError({ statusCode: 404, message: 'Member not found' });
  if (mem.role === 'owner') throw new ApiError(403, 'Cannot remove the company owner');

  await db.delete(companyMembers).where(eq(companyMembers.id, id));

  return { ok: true };
});
