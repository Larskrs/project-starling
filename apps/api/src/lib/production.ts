import { eq, and, or, inArray } from 'drizzle-orm';
import { db, companies, productions, companyMembers, productionMembers, productionRoles } from '@starling/db';
import { type ApiEvent, createError, requireAuth } from './handler.js';
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
}

export type ProductionRef =
  | { cslug: string; pslug: string }
  | { productionId: string; companyId?: string };

async function resolveRef(ref: ProductionRef): Promise<{ company: typeof companies.$inferSelect; production: typeof productions.$inferSelect }> {
  if ('cslug' in ref) {
    const [company] = await db.select().from(companies).where(eq(companies.slug, ref.cslug)).limit(1);
    if (!company) throw createError({ statusCode: 404, message: 'Company not found' });

    const [production] = await db.select().from(productions)
      .where(and(eq(productions.companyId, company.id), eq(productions.slug, ref.pslug)))
      .limit(1);
    if (!production) throw createError({ statusCode: 404, message: 'Production not found' });

    return { company, production };
  } else {
    const [production] = await db.select().from(productions).where(eq(productions.id, ref.productionId)).limit(1);
    if (!production) throw createError({ statusCode: 404, message: 'Production not found' });

    const companyId = ref.companyId ?? production.companyId;
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!company) throw createError({ statusCode: 404, message: 'Company not found' });

    return { company, production };
  }
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
    return { auth, company, production, privileged: true, memberRoleId: null };
  }

  const [companyMem] = await db.select({ id: companyMembers.id })
    .from(companyMembers)
    .where(and(
      eq(companyMembers.companyId, company.id),
      eq(companyMembers.userId, auth.userId),
      or(eq(companyMembers.role, 'owner'), eq(companyMembers.role, 'admin')),
    ))
    .limit(1);

  if (companyMem) {
    return { auth, company, production, privileged: true, memberRoleId: null };
  }

  const [prodMem] = await db.select({ id: productionMembers.id, roleId: productionMembers.roleId })
    .from(productionMembers)
    .where(and(
      eq(productionMembers.productionId, production.id),
      eq(productionMembers.userId, auth.userId),
    ))
    .limit(1);

  if (!prodMem) throw createError({ statusCode: 403, message: 'Access denied' });

  return { auth, company, production, privileged: false, memberRoleId: prodMem.roleId };
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

  let rolePermissions: bigint | null = null;
  if (ctx.memberRoleId) {
    const [role] = await db.select({ permissions: productionRoles.permissions })
      .from(productionRoles)
      .where(eq(productionRoles.id, ctx.memberRoleId))
      .limit(1);
    rolePermissions = role?.permissions ?? null;
  }

  if (!can(ctx.auth.role, rolePermissions, required)) {
    const name = (Object.entries(Permission) as [PermissionName, bigint][])
      .find(([, bit]) => bit === required)?.[0];
    const description = name ? PERMISSION_MESSAGES[name] : 'perform this action';
    throw createError({
      statusCode: 403,
      message:    `You don't have permission to ${description}`,
      data:       { missingPermission: name ?? 'UNKNOWN', role: ctx.auth.role },
    });
  }
}
