import { eq, and, or, inArray } from 'drizzle-orm';
import {
  db, companies, productions, companyMembers, productionMembers, productionRoles, timelines,
} from '@starling/db';
import { type ApiEvent, createError, getPrincipal, getRouterParam, type Principal } from './handler.js';
import { can } from './permissions.js';
import { type PermissionName, Permission, PERMISSION_MESSAGES } from '@starling/auth/permissions';

export interface ProductionContext {
  /**
   * The acting user. For an API token this is the person who ISSUED it, kept
   * for attribution only, and `role` is pinned to 'user' so a token minted by a
   * global admin cannot inherit that admin's short-circuit.
   *
   * Anything that is genuinely about a person — activity feeds, authorship,
   * "did I do this" checks — must branch on `principal.kind` instead of reading
   * this blindly. It is the empty string when the issuing user has been deleted.
   */
  auth:         { userId: string; role: 'admin' | 'user' };
  /** Who is actually calling: a signed-in person, or a machine token. */
  principal:    Principal;
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

/** The membership part of a ProductionContext — what resolveAccessLevel yields. */
export interface AccessLevel {
  privileged:      boolean;
  memberRoleId:    string | null;
  rolePermissions: bigint | null;
}

/**
 * What resolveAccessLevel needs to know about a caller, independent of how it
 * was authenticated.
 */
export type AccessPrincipal =
  | { kind: 'user'; id: string; role: 'admin' | 'user' }
  | { kind: 'token'; id: string; productionId: string; permissions: bigint };

/**
 * Core membership resolution shared by REST (requireProductionAccess) and the
 * socket layer (timeline join): global admin or company owner/admin →
 * privileged; else explicit production membership with its role permissions
 * resolved in the same pass. Returns null when the caller has no access.
 *
 * The token branch is the whole reason machine access needed no parallel
 * permission system: a token already carries one production and one masked
 * permission set, so it resolves without touching the membership tables at all.
 */
export async function resolveAccessLevel(
  principal: AccessPrincipal,
  companyId: string,
  productionId: string,
): Promise<AccessLevel | null> {
  if (principal.kind === 'token') {
    // One production, and only that one. A token can never be privileged: the
    // company-admin and global-admin paths are how a person escapes a single
    // production, and a device has no business escaping.
    if (principal.productionId !== productionId) return null;
    return { privileged: false, memberRoleId: null, rolePermissions: principal.permissions };
  }

  const user = principal;
  if (user.role === 'admin') {
    return { privileged: true, memberRoleId: null, rolePermissions: null };
  }

  // Both membership checks are independent — run them in parallel, and resolve
  // the member's role permissions in the same query so permission checks never
  // need another round-trip.
  const [[companyMem], [prodMem]] = await Promise.all([
    db.select({ id: companyMembers.id })
      .from(companyMembers)
      .where(and(
        eq(companyMembers.companyId, companyId),
        eq(companyMembers.userId, user.id),
        or(eq(companyMembers.role, 'owner'), eq(companyMembers.role, 'admin')),
      ))
      .limit(1),
    db.select({ roleId: productionMembers.roleId, permissions: productionRoles.permissions })
      .from(productionMembers)
      .leftJoin(productionRoles, eq(productionMembers.roleId, productionRoles.id))
      .where(and(
        eq(productionMembers.productionId, productionId),
        eq(productionMembers.userId, user.id),
      ))
      .limit(1),
  ]);

  if (companyMem) return { privileged: true, memberRoleId: null, rolePermissions: null };
  if (!prodMem)   return null;

  return {
    privileged:      false,
    memberRoleId:    prodMem.roleId,
    rolePermissions: prodMem.permissions ?? null,
  };
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
  const principal = await getPrincipal(event);
  if (!principal) throw createError({ statusCode: 401, message: 'Authentication required', errorKey: 'errors.generic.authRequired' });

  const { company, production } = await resolveRef(ref);

  // This preamble is where an API token is ALLOWED in. Everything outside a
  // production goes through requireAuth, which refuses tokens outright — so a
  // device reaches exactly the production it was issued for, bounded by a role
  // that can never hold the escalation bits.
  const access: AccessPrincipal = principal.kind === 'token'
    ? { kind: 'token', id: principal.tokenId, productionId: principal.productionId, permissions: principal.permissions }
    : { kind: 'user',  id: principal.userId,  role: principal.role };

  const level = await resolveAccessLevel(access, company.id, production.id);
  if (!level) throw createError({ statusCode: 403, message: 'Access denied', errorKey: 'errors.generic.accessDenied' });

  const auth = principal.kind === 'token'
    ? { userId: principal.createdBy ?? '', role: 'user' as const }
    : { userId: principal.userId, role: principal.role };

  return { auth, principal, company, production, ...level };
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
  // `required` may be a mask of alternatives (any bit passes); the message
  // names the first (primary) permission in the mask.
  if (!can(ctx.auth.role, ctx.rolePermissions, required)) {
    const name = (Object.entries(Permission) as [PermissionName, bigint][])
      .find(([, bit]) => (bit & required) !== 0n)?.[0];
    const description = name ? PERMISSION_MESSAGES[name] : 'perform this action';
    throw createError({
      statusCode: 403,
      message:    `You don't have permission to ${description}`,
      data:       { missingPermission: name ?? 'UNKNOWN', role: ctx.auth.role },
      errorKey:   'errors.permission.missing',
    });
  }
}

// ── Flat-route scoping ────────────────────────────────────────────────────────
// Resources hang off an id-scoped path prefix — /api/production/[pid]/… and
// /api/timeline/[tlId]/… — while top-level collections scope by query param
// (/api/timelines?pid=…). All preambles resolve the owning production, run the
// access check, and optionally assert a permission.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Access preamble for /api/production/[pid]/… routes. */
export async function requireProductionParam(
  event: ApiEvent,
  opts: { permission?: bigint } = {},
): Promise<ProductionContext> {
  const pid = getRouterParam(event, 'pid');
  if (!pid || !UUID_RE.test(pid))
    throw createError({ statusCode: 404, message: 'Production not found', errorKey: 'errors.production.notFound' });

  const ctx = await requireProductionAccess(event, { productionId: pid });
  if (opts.permission !== undefined) await requirePermission(ctx, opts.permission);
  return ctx;
}

/**
 * Access preamble for /api/timeline/[tlId]/… routes: resolves the timeline,
 * then checks access on its owning production. The full timeline row rides
 * along so handlers don't re-fetch it.
 */
export async function requireTimelineParam(
  event: ApiEvent,
  opts: { permission?: bigint } = {},
): Promise<ProductionContext & { timeline: typeof timelines.$inferSelect }> {
  const tlId = getRouterParam(event, 'tlId');
  if (!tlId || !UUID_RE.test(tlId))
    throw createError({ statusCode: 404, message: 'Timeline not found' });

  const [timeline] = await db.select().from(timelines).where(eq(timelines.id, tlId)).limit(1);
  if (!timeline) throw createError({ statusCode: 404, message: 'Timeline not found' });

  const ctx = await requireProductionAccess(event, { productionId: timeline.productionId });
  if (opts.permission !== undefined) await requirePermission(ctx, opts.permission);
  return { ...ctx, timeline };
}

/**
 * Refuses a mutation aimed at a locked track.
 *
 * The lock is a collaboration guard, not a permission: everyone editing a
 * timeline has EDIT_TIMELINE, and locking a track is how one of them says
 * "leave this alone". It therefore has to be enforced HERE and not only in the
 * editor — a peer whose client hasn't yet received the lock would otherwise
 * push the edit through and live sync would relay it to everybody.
 *
 * Callers already load the track for their ownership check, so this takes the
 * flag rather than issuing a query of its own.
 */
export function assertTrackUnlocked(isLocked: boolean | null | undefined): void {
  if (!isLocked) return;
  throw createError({ statusCode: 423, message: 'Track is locked', errorKey: 'errors.track.locked' });
}

/** Access preamble for top-level collections scoped by ?pid=… (/api/timelines). */
export async function requireProductionQuery(
  event: ApiEvent,
  opts: { permission?: bigint } = {},
): Promise<ProductionContext> {
  const pid = event.url.searchParams.get('pid');
  if (!pid || !UUID_RE.test(pid)) {
    throw createError({
      statusCode: 422,
      message:    'Missing or invalid "pid" query parameter',
      errorKey:   'errors.generic.validationFailed',
    });
  }

  const ctx = await requireProductionAccess(event, { productionId: pid });
  if (opts.permission !== undefined) await requirePermission(ctx, opts.permission);
  return ctx;
}
