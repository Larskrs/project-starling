import { eq, and, or, inArray } from 'drizzle-orm';
import { db, companies, productions, companyMembers, productionMembers, productionRoles } from '@starling/db';
import { type ApiEvent, createError, requireAuth, getRouterParam } from './handler.js';
import { can } from './permissions.js';
import { type PermissionName, Permission, PERMISSION_MESSAGES } from '@starling/auth/permissions';

export interface ProductionContext {
  auth:         { userId: string; role: 'admin' | 'user' };
  company:      { id: string; name: string; slug: string };
  production:   typeof productions.$inferSelect;
  /** True for global admins and company owner/admin — all permission checks pass automatically. */
  privileged:   boolean;
  /** The member's current roleId; null when they have no role. Always null when privileged. */
  memberRoleId: string | null;
  /** The member's role permission bits, resolved during the access check. Null when privileged or roleless. */
  rolePermissions: bigint | null;
}

export type ProductionRef =
  | { cslug: string; pslug: string }
  | { productionId: string; companyId?: string };

async function resolveRef(ref: ProductionRef): Promise<{ company: typeof companies.$inferSelect; production: typeof productions.$inferSelect }> {
  // One joined query for the happy path; the extra company lookup only runs on
  // the failure path to pick the more precise 404 errorKey.
  const where = 'cslug' in ref
    ? and(eq(companies.slug, ref.cslug), eq(productions.slug, ref.pslug))
    : ref.companyId !== undefined
      ? and(eq(productions.id, ref.productionId), eq(productions.companyId, ref.companyId))
      : eq(productions.id, ref.productionId);

  const [row] = await db
    .select({ company: companies, production: productions })
    .from(productions)
    .innerJoin(companies, eq(productions.companyId, companies.id))
    .where(where)
    .limit(1);

  if (row) return row;

  if ('cslug' in ref) {
    const [company] = await db.select({ id: companies.id }).from(companies)
      .where(eq(companies.slug, ref.cslug)).limit(1);
    if (!company) throw createError({ statusCode: 404, message: 'Company not found', errorKey: 'errors.company.notFound' });
  }
  throw createError({ statusCode: 404, message: 'Production not found', errorKey: 'errors.production.notFound' });
}

/**
 * Resolves company + production and verifies the caller has access:
 * global admin, company owner/admin, or explicit production membership.
 * Accepts slugs ({ cslug, pslug }) or IDs ({ productionId, companyId? }).
 * Throws 401 / 403 / 404 as appropriate.
 */
export async function requireProductionAccess(
  event: ApiEvent,
  ref: ProductionRef,
): Promise<ProductionContext> {
  const auth = await requireAuth(event);
  const { company, production } = await resolveRef(ref);

  if (auth.role === 'admin') {
    return { auth, company, production, privileged: true, memberRoleId: null, rolePermissions: null };
  }

  // Both membership checks are independent — run them in parallel, and resolve
  // the member's role permissions in the same query so requirePermission never
  // needs another round-trip.
  const [[companyMem], [prodMem]] = await Promise.all([
    db.select({ id: companyMembers.id })
      .from(companyMembers)
      .where(and(
        eq(companyMembers.companyId, company.id),
        eq(companyMembers.userId, auth.userId),
        or(eq(companyMembers.role, 'owner'), eq(companyMembers.role, 'admin')),
      ))
      .limit(1),
    db.select({ roleId: productionMembers.roleId, permissions: productionRoles.permissions })
      .from(productionMembers)
      .leftJoin(productionRoles, eq(productionMembers.roleId, productionRoles.id))
      .where(and(
        eq(productionMembers.productionId, production.id),
        eq(productionMembers.userId, auth.userId),
      ))
      .limit(1),
  ]);

  if (companyMem) {
    return { auth, company, production, privileged: true, memberRoleId: null, rolePermissions: null };
  }

  if (!prodMem) throw createError({ statusCode: 403, message: 'Access denied', errorKey: 'errors.generic.accessDenied' });

  return {
    auth, company, production,
    privileged:      false,
    memberRoleId:    prodMem.roleId,
    rolePermissions: prodMem.permissions ?? null,
  };
}

/**
 * Returns a WHERE clause fragment that limits a `productions` query to rows
 * the given user can access, mirroring the same rules as requireProductionAccess:
 * - global admin  → undefined (no filter, caller sees everything)
 * - company admin/owner → filter by their admin company IDs
 * - regular member → filter to productions they're explicitly a member of
 *
 * Returns null when the user has no access to anything.
 */
export async function productionAccessFilter(
  auth: { userId: string; role: 'admin' | 'user' },
) {
  if (auth.role === 'admin') return undefined;

  const [adminCompanies, memberships] = await Promise.all([
    db.select({ companyId: companyMembers.companyId })
      .from(companyMembers)
      .where(and(
        eq(companyMembers.userId, auth.userId),
        or(eq(companyMembers.role, 'owner'), eq(companyMembers.role, 'admin')),
      )),
    db.select({ productionId: productionMembers.productionId })
      .from(productionMembers)
      .where(eq(productionMembers.userId, auth.userId)),
  ]);

  const adminCompanyIds    = adminCompanies.map(c => c.companyId);
  const memberProductionIds = memberships.map(m => m.productionId);

  const conditions = [
    ...(adminCompanyIds.length     > 0 ? [inArray(productions.companyId, adminCompanyIds)]    : []),
    ...(memberProductionIds.length > 0 ? [inArray(productions.id, memberProductionIds)]       : []),
  ];

  return conditions.length > 0 ? or(...conditions) : null;
}

/**
 * Asserts the caller holds a specific production permission.
 * Privileged users (global admin, company owner/admin) always pass.
 * Throws 403 with a human-readable message and data.missingPermission set to
 * the permission key (e.g. "MANAGE_MEMBERS") for structured client handling.
 */
export async function requirePermission(
  ctx: ProductionContext,
  required: bigint,
): Promise<void> {
  if (ctx.privileged) return;

  // Role permissions were joined in during the access check — no extra query.
  if (!can(ctx.auth.role, ctx.rolePermissions, required)) {
    const name = (Object.entries(Permission) as [PermissionName, bigint][])
      .find(([, bit]) => bit === required)?.[0];
    const description = name ? PERMISSION_MESSAGES[name] : 'perform this action';
    throw createError({
      statusCode: 403,
      message:    `You don't have permission to ${description}`,
      data:       { missingPermission: name ?? 'UNKNOWN', role: ctx.auth.role },
      errorKey:   'errors.permission.missing',
    });
  }
}

/**
 * One-call preamble for /company/[cslug]/production/[pslug]/… routes:
 * extracts cslug/pslug plus any extra router params (400 if missing),
 * resolves production access, and optionally asserts a permission.
 * Extra params are returned by name in `params`.
 */
export async function requireProductionRoute(
  event: ApiEvent,
  opts: { permission?: bigint; params?: string[] } = {},
): Promise<ProductionContext & { params: Record<string, string> }> {
  const params: Record<string, string> = {};
  for (const name of ['cslug', 'pslug', ...(opts.params ?? [])]) {
    const value = getRouterParam(event, name);
    if (!value) throw createError({ statusCode: 400, message: 'Missing params' });
    params[name] = value;
  }

  const ctx = await requireProductionAccess(event, { cslug: params.cslug!, pslug: params.pslug! });
  if (opts.permission !== undefined) await requirePermission(ctx, opts.permission);

  return { ...ctx, params };
}
