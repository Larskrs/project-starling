import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { db, apiTokens, apiTokenEvents, productionRoles } from '@starling/db';
import { Permission, decode } from '@starling/auth/permissions';
import { TtlCache } from './cache.js';

/**
 * API tokens for installed equipment.
 *
 * The wire contract these implement is documented for integrators in
 * docs/integrations — keep the two in step, particularly the token format and
 * the revocation guarantee.
 */

/** Tokens read `cino_svc_<32 hex id>_<secret>`. */
const TOKEN_PREFIX = 'cino_svc_';
const TOKEN_RE = /^cino_svc_([0-9a-f]{32})_([A-Za-z0-9_-]{32,64})$/;

/**
 * 30 days. Short on purpose: an installed device nobody audits is exactly the
 * credential that should not be permanent, and a fixed window forces rotation
 * to be part of the install rather than an emergency.
 */
export const TOKEN_TTL_DAYS = 30;
const TOKEN_TTL_MS = TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Bits a token may never hold, whatever its role says.
 *
 * A device must not be able to grant access — that is how one compromised desk
 * becomes a compromised production. ADMINISTRATOR is in the list because `can()`
 * short-circuits on it and would pass every other check.
 *
 * Applied when access is RESOLVED, not when the token is created, so editing a
 * role later cannot widen a token that already exists.
 */
export const TOKEN_FORBIDDEN_PERMISSIONS =
  Permission.ADMINISTRATOR | Permission.MANAGE_MEMBERS | Permission.MANAGE_ROLES;

export function maskTokenPermissions(bits: bigint | null): bigint {
  return (bits ?? 0n) & ~TOKEN_FORBIDDEN_PERMISSIONS;
}

// ── Hashing ───────────────────────────────────────────────────────────────────

/**
 * SHA-256, not scrypt.
 *
 * The secret is 32 bytes from a CSPRNG, so there is no low-entropy guess to
 * slow down — the work factor that protects a human password buys nothing here.
 * It would however be paid on EVERY request, and a desk polling the API would
 * feel it immediately.
 */
function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

// ── Issuing ───────────────────────────────────────────────────────────────────

export interface IssuedToken {
  id: string;
  /** Shown to the operator EXACTLY once — only the hash is stored. */
  plaintext: string;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Mints a token, embedding its own row id so verification is a primary-key
 * lookup rather than a scan. The id half is public; only the secret half is
 * hashed.
 */
export function issueToken(): IssuedToken {
  const id     = randomUUID();
  const secret = randomBytes(32).toString('base64url');

  return {
    id,
    plaintext: `${TOKEN_PREFIX}${id.replace(/-/g, '')}_${secret}`,
    tokenHash: hashSecret(secret),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  };
}

/** Reverses the compact id half of a token back into a uuid. */
function uuidFromCompact(compact: string): string {
  return [
    compact.slice(0, 8), compact.slice(8, 12), compact.slice(12, 16),
    compact.slice(16, 20), compact.slice(20),
  ].join('-');
}

// ── Verification ──────────────────────────────────────────────────────────────

export type TokenRow = typeof apiTokens.$inferSelect;

export interface TokenPrincipal {
  kind: 'token';
  tokenId: string;
  productionId: string;
  roleId: string | null;
  label: string;
  profileImageId: string | null;
  createdBy: string | null;
  expiresAt: Date;
  /** Already masked — never widen from this. */
  permissions: bigint;
}

export type TokenFailure = 'tokenInvalid' | 'tokenExpired';

export type TokenResult =
  | { ok: true; principal: TokenPrincipal }
  | { ok: false; reason: TokenFailure };

/**
 * Row cache keyed by token id, mirroring the session cache's 30s staleness.
 *
 * The SECRET is never cached — the hash is re-verified on every request against
 * the cached row, which costs one SHA-256. Revocation clears the entry in
 * process, so the interval revalidation is a backstop rather than the primary
 * path.
 */
interface CachedToken { row: TokenRow; permissions: bigint }
const tokenCache = new TtlCache<string, CachedToken>(30_000, 2000);

export function invalidateToken(tokenId: string): void {
  tokenCache.delete(tokenId);
}

/** Last-used is a liveness hint, so it is written at most this often per token. */
const LAST_USED_THROTTLE_MS = 60_000;
const lastUsedWrites = new Map<string, number>();

function touchLastUsed(tokenId: string): void {
  const now  = Date.now();
  const prev = lastUsedWrites.get(tokenId) ?? 0;
  if (now - prev < LAST_USED_THROTTLE_MS) return;
  lastUsedWrites.set(tokenId, now);

  // Fire and forget: a liveness column must never delay or fail a request.
  void db.update(apiTokens).set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, tokenId))
    .catch(() => {});
}

/**
 * Resolves a raw bearer token to a principal.
 *
 * Returns a reason rather than throwing so the caller can answer with the right
 * errorKey — an integrator needs to tell "retry is pointless" from "ask for a
 * different role".
 */
export async function verifyApiToken(raw: string): Promise<TokenResult> {
  const match = TOKEN_RE.exec(raw.trim());
  if (!match) return { ok: false, reason: 'tokenInvalid' };

  const tokenId = uuidFromCompact(match[1]!);
  const secret  = match[2]!;

  let cached = tokenCache.get(tokenId);
  if (!cached) {
    const [row] = await db
      .select({ token: apiTokens, permissions: productionRoles.permissions })
      .from(apiTokens)
      .leftJoin(productionRoles, eq(apiTokens.roleId, productionRoles.id))
      .where(eq(apiTokens.id, tokenId))
      .limit(1);

    if (!row) return { ok: false, reason: 'tokenInvalid' };
    cached = { row: row.token, permissions: maskTokenPermissions(row.permissions) };
    tokenCache.set(tokenId, cached);
  }

  // Verified even on a cache hit: the cache holds the row, never the secret.
  if (!hashesMatch(cached.row.tokenHash, hashSecret(secret))) {
    return { ok: false, reason: 'tokenInvalid' };
  }

  // A revoked token is reported as invalid rather than as revoked. Confirming
  // that a specific secret once existed tells an attacker something; "no" tells
  // them nothing.
  if (cached.row.revokedAt) return { ok: false, reason: 'tokenInvalid' };
  if (cached.row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'tokenExpired' };

  touchLastUsed(tokenId);

  return {
    ok: true,
    principal: {
      kind:         'token',
      tokenId,
      productionId: cached.row.productionId,
      roleId:       cached.row.roleId,
      label:        cached.row.label,
      profileImageId: cached.row.profileImageId,
      createdBy:    cached.row.createdBy,
      expiresAt:    cached.row.expiresAt,
      permissions:  cached.permissions,
    },
  };
}

/** Header letting a device warn before it is locked out rather than after. */
export const TOKEN_EXPIRES_HEADER = 'X-Cino-Token-Expires';

// ── Audit log ─────────────────────────────────────────────────────────────────

export type TokenAuditEvent = (typeof apiTokenEvents.$inferSelect)['event'];

export interface TokenAuditInput {
  tokenId?:      string | null;
  productionId?: string | null;
  event:         TokenAuditEvent;
  entityType?:   string | null;
  entityId?:     string | null;
  actorUserId?:  string | null;
  ip?:           string | null;
  detail?:       string | null;
}

/**
 * Appends to the audit log. Never coalesced, never awaited by a request.
 *
 * Fire-and-forget for the same reason activity logging is: an audit record is a
 * side effect of a request, never its purpose, so a failure here must not turn
 * a working call into a 500. A dropped row is visible as a gap; a failed show is
 * not recoverable.
 */
export function recordTokenEvent(input: TokenAuditInput): void {
  void db.insert(apiTokenEvents).values({
    tokenId:      input.tokenId ?? null,
    productionId: input.productionId ?? null,
    event:        input.event,
    entityType:   input.entityType ?? null,
    entityId:     input.entityId ?? null,
    actorUserId:  input.actorUserId ?? null,
    ip:           input.ip ?? null,
    detail:       input.detail ?? null,
  }).catch((err) => {
    console.warn('[apiTokens] failed to record event', err);
  });
}

/**
 * Live tokens for a production, newest first. Never returns a hash.
 *
 * Permissions are reported MASKED, because that is what the token actually
 * holds. Showing the role's raw bits would let the page imply a device has
 * powers it was never given — which is the whole failure mode masking exists
 * to avoid.
 */
export async function listProductionTokens(productionId: string) {
  const rows = await db
    .select({
      id:         apiTokens.id,
      label:      apiTokens.label,
      profileImageId: apiTokens.profileImageId,
      roleId:     apiTokens.roleId,
      roleName:   productionRoles.name,
      roleHue:    productionRoles.hue,
      rolePerms:  productionRoles.permissions,
      createdBy:  apiTokens.createdBy,
      createdAt:  apiTokens.createdAt,
      expiresAt:  apiTokens.expiresAt,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    .leftJoin(productionRoles, eq(apiTokens.roleId, productionRoles.id))
    .where(and(eq(apiTokens.productionId, productionId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));

  return rows.map(({ rolePerms, ...row }) => ({
    ...row,
    // Strings on the wire: a bigint does not survive JSON.
    permissions: maskTokenPermissions(rolePerms).toString(),
    withheld:    decode((rolePerms ?? 0n) & TOKEN_FORBIDDEN_PERMISSIONS),
  }));
}
