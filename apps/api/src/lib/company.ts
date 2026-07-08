import { eq, and, or } from 'drizzle-orm';
import { db, companies, companyMembers } from '@starling/db';
import { type ApiEvent, createError, requireAuth } from './handler.js';

export type CompanyRef = { companyId: string } | { slug: string };

export interface CompanyContext {
  auth:      { userId: string; role: 'admin' | 'user' };
  company:   typeof companies.$inferSelect;
  /** True for global admins and company owner/admin. */
  canManage: boolean;
}

/**
 * Resolves a company by id or slug and reports whether the caller can manage
 * it (global admin, or company owner/admin). Throws 401 / 404.
 */
export async function requireCompanyAccess(event: ApiEvent, ref: CompanyRef): Promise<CompanyContext> {
  const auth = await requireAuth(event);

  const where = 'companyId' in ref ? eq(companies.id, ref.companyId) : eq(companies.slug, ref.slug);
  const [company] = await db.select().from(companies).where(where).limit(1);
  if (!company) throw createError({ statusCode: 404, message: 'Company not found', errorKey: 'errors.company.notFound' });

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

  return { auth, company, canManage };
}

/** Same as requireCompanyAccess, but throws 403 unless the caller can manage the company. */
export async function requireCompanyAdmin(event: ApiEvent, ref: CompanyRef): Promise<CompanyContext> {
  const ctx = await requireCompanyAccess(event, ref);
  if (!ctx.canManage) throw createError({ statusCode: 403, message: 'Company admin access required', errorKey: 'errors.generic.accessDenied' });
  return ctx;
}
