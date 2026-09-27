import { and, eq, gt, isNull, or, sql, desc } from 'drizzle-orm';
import {
  db, productionInvites, productionMembers, productions, companies, productionRoles, users,
} from '@starling/db';
import { createRateLimiter } from '../http/rateLimit.js';
import { mintSecret, hashSecret } from '../auth/secrets.js';
import { productionPath } from '../util/appPaths.js';
import { normalizeEmail } from '../auth/user.js';

/**
 * Invitations to a production.
 *
 * Two shapes, one table. An invite bound to an `email` is single-use and short
 * lived — it is a credential mailed to one person. An invite with no email is a
 * shareable link: anyone holding it may redeem it, until it expires or its use
 * cap runs out.
 *
 * The plaintext token exists only inside the link that was sent. Only its
 * SHA-256 is stored, the same reasoning as apiTokens.ts: the secret is 32 bytes
 * from a CSPRNG, so there is no low-entropy guess for scrypt to slow down, and
 * a stolen database dump still cannot be replayed.
 */

/** Emailed to one person, so it should not sit in an inbox for long. */
export const EMAIL_INVITE_TTL_HOURS = 1;

/** A link a producer hands round a rehearsal room lives longer. */
export const LINK_INVITE_TTL_HOURS = 7 * 24;

/** Ceiling for a caller-supplied expiry. Nothing here is a permanent key. */
export const MAX_INVITE_TTL_HOURS = 30 * 24;

/**
 * An invite is an email someone else receives, so it is a spam lever as much as
 * a feature: 30 per hour per user across all their productions. One shared
 * bucket, keyed by user id, for every route that issues one — a limit that only
 * guards some of the doors guards none of them.
 */
export const inviteLimiter = createRateLimiter({ windowMs: 60 * 60_000, max: 30 });

export function inviteUrlPath(token: string): string {
  return `/invite/${token}`;
}

// ── Issuing ───────────────────────────────────────────────────────────────────

export interface IssueInviteInput {
  productionId:    string;
  roleId?:         string | null;
  /** Set to bind the invite to one address; omit for a shareable link. */
  email?:          string | null;
  createdBy:       string | null;
  expiresInHours?: number;
  /** Ignored for an emailed invite, which is always single-use. */
  maxUses?:        number | null;
}

export interface IssuedInvite {
  invite: typeof productionInvites.$inferSelect;
  /** Returned exactly once — only the hash is kept. */
  token:  string;
}

export async function issueInvite(input: IssueInviteInput): Promise<IssuedInvite> {
  const email = input.email ? normalizeEmail(input.email) || null : null;
  const token = mintSecret();

  const defaultTtl = email ? EMAIL_INVITE_TTL_HOURS : LINK_INVITE_TTL_HOURS;
  const ttlHours   = Math.min(input.expiresInHours ?? defaultTtl, MAX_INVITE_TTL_HOURS);

  // Inviting the same address again replaces the pending invite rather than
  // stacking a second one beside it: the pending list shows one row per
  // person, and the link in the newest mail is the one that works.
  if (email) {
    await db
      .update(productionInvites)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(productionInvites.productionId, input.productionId),
        eq(productionInvites.email, email),
        isNull(productionInvites.revokedAt),
        eq(productionInvites.useCount, 0),
      ));
  }

  const [invite] = await db.insert(productionInvites).values({
    productionId: input.productionId,
    roleId:       input.roleId ?? null,
    email,
    tokenHash:    hashSecret(token),
    createdBy:    input.createdBy,
    expiresAt:    new Date(Date.now() + ttlHours * 60 * 60 * 1000),
    // One person, one use. A link may be capped or left open until it expires.
    maxUses:      email ? 1 : input.maxUses ?? null,
  }).returning();

  return { invite: invite!, token };
}

// ── Reading ───────────────────────────────────────────────────────────────────

export type InviteRejection = 'notFound' | 'expired' | 'revoked' | 'exhausted' | 'emailMismatch';

export interface InvitePreview {
  email:      string | null;
  expiresAt:  Date;
  production: { id: string; name: string; slug: string; profileImageId: string | null };
  company:    { id: string; name: string; slug: string };
  /** First name of whoever sent it, when they still have an account. */
  inviterName: string | null;
  roleName:    string | null;
}

export type InviteLookup =
  | { ok: true;  invite: typeof productionInvites.$inferSelect; preview: InvitePreview; alreadyMember: boolean }
  | { ok: false; reason: InviteRejection };

/**
 * Resolves a token to what it grants, without redeeming it.
 *
 * Deliberately says WHY a token failed. The token is 256 bits of secret, so
 * there is nothing to enumerate by guessing, and "this invite expired" is the
 * difference between a person retrying and a person giving up.
 *
 * Pass `viewerId` when someone is signed in: if they already belong to the
 * production, the invite resolves whatever state it is in. Re-opening the link
 * after joining is the most natural thing for a person to do, and "this invite
 * was used up" — by them — reads as though joining failed.
 */
export async function lookupInvite(token: string, viewerId?: string): Promise<InviteLookup> {
  if (!token) return { ok: false, reason: 'notFound' };

  const [row] = await db
    .select({
      invite:     productionInvites,
      production: productions,
      company:    companies,
      inviter:    { firstName: users.first_name, name: users.name },
      role:       { name: productionRoles.name },
    })
    .from(productionInvites)
    .innerJoin(productions, eq(productionInvites.productionId, productions.id))
    .innerJoin(companies, eq(productions.companyId, companies.id))
    .leftJoin(users, eq(productionInvites.createdBy, users.id))
    .leftJoin(productionRoles, eq(productionInvites.roleId, productionRoles.id))
    .where(eq(productionInvites.tokenHash, hashSecret(token)))
    .limit(1);

  if (!row) return { ok: false, reason: 'notFound' };

  const { invite } = row;
  const alreadyMember = viewerId ? await isMember(invite.productionId, viewerId) : false;

  if (!alreadyMember) {
    if (invite.revokedAt) return { ok: false, reason: 'revoked' };
    if (invite.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };
    if (isSpent(invite)) return { ok: false, reason: 'exhausted' };
  }

  return {
    ok:     true,
    invite,
    alreadyMember,
    preview: {
      email:      invite.email,
      expiresAt:  invite.expiresAt,
      production: {
        id:             row.production.id,
        name:           row.production.name,
        slug:           row.production.slug,
        profileImageId: row.production.profileImageId,
      },
      company:     { id: row.company.id, name: row.company.name, slug: row.company.slug },
      inviterName: row.inviter?.firstName || row.inviter?.name || null,
      roleName:    row.role?.name ?? null,
    },
  };
}

// ── Redeeming ─────────────────────────────────────────────────────────────────

export type AcceptResult =
  | { ok: true;  preview: InvitePreview; alreadyMember: boolean }
  | { ok: false; reason: InviteRejection };

/**
 * Redeems a token for the signed-in user.
 *
 * The use count is claimed with a single conditional UPDATE rather than a
 * read-then-write: two people opening the last seat of a capped link at the
 * same moment would both pass a check-first version, and the row would end up
 * over its own limit.
 */
export async function acceptInvite(
  token: string,
  user:  { id: string; email: string },
): Promise<AcceptResult> {
  const found = await lookupInvite(token, user.id);
  if (!found.ok) return found;

  const { invite, preview } = found;

  // Already in — don't burn a use. Nothing is granted, so there is nothing for
  // the address check below to protect.
  if (found.alreadyMember) return { ok: true, preview, alreadyMember: true };

  // An emailed invite is addressed to one person. Without this, forwarding the
  // mail would hand the production to whoever received it next.
  if (invite.email && invite.email !== normalizeEmail(user.email)) {
    return { ok: false, reason: 'emailMismatch' };
  }

  const [claimed] = await db
    .update(productionInvites)
    .set({ useCount: sql`${productionInvites.useCount} + 1`, lastUsedAt: new Date() })
    .where(and(
      eq(productionInvites.id, invite.id),
      isNull(productionInvites.revokedAt),
      gt(productionInvites.expiresAt, new Date()),
      or(
        isNull(productionInvites.maxUses),
        sql`${productionInvites.useCount} < ${productionInvites.maxUses}`,
      ),
    ))
    .returning();

  if (!claimed) return { ok: false, reason: 'exhausted' };

  try {
    await db.insert(productionMembers).values({
      productionId: invite.productionId,
      userId:       user.id,
      roleId:       invite.roleId,
    });
  } catch (err) {
    // A concurrent join through another route can win the unique index. The
    // person is a member either way, which is all the caller asked for.
    const code = (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
    if (code === '23505') return { ok: true, preview, alreadyMember: true };

    // Anything else means they did not join, so the use claimed above is handed
    // back — otherwise a single-use emailed invite would be gone for nothing.
    await db
      .update(productionInvites)
      .set({ useCount: sql`greatest(${productionInvites.useCount} - 1, 0)` })
      .where(eq(productionInvites.id, invite.id));
    throw err;
  }

  return { ok: true, preview, alreadyMember: false };
}

async function isMember(productionId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: productionMembers.id })
    .from(productionMembers)
    .where(and(eq(productionMembers.productionId, productionId), eq(productionMembers.userId, userId)))
    .limit(1);
  return Boolean(row);
}

/**
 * An invite with no uses left. The row is kept rather than deleted — so the
 * person who used it can still open the link and be sent to the production —
 * and `listInvites` leaves it out, so it does not read as a pending reply.
 */
function isSpent(invite: typeof productionInvites.$inferSelect): boolean {
  return invite.maxUses !== null && invite.useCount >= invite.maxUses;
}

/**
 * What register/login report back about an invite they were handed.
 *
 * A bad invite never fails the sign-in it rode along with: the account and the
 * session are real either way, and the client shows why the invite did not
 * apply instead of a page that says nothing worked.
 */
export interface InviteOutcome {
  accepted: boolean;
  reason?:  InviteRejection;
  /** Where to land the user, when they did join something. */
  path?:    string;
  production?: { name: string; slug: string };
  company?:    { name: string; slug: string };
  /** True when the invite was addressed to the email that just authenticated. */
  emailBound?: boolean;
}

export async function redeemForAuth(
  token: string,
  user:  { id: string; email: string },
): Promise<InviteOutcome> {
  const result = await acceptInvite(token, user);
  if (!result.ok) return { accepted: false, reason: result.reason };

  const { preview } = result;
  return {
    accepted:   true,
    path:       productionPath(preview.company.slug, preview.production.slug),
    production: { name: preview.production.name, slug: preview.production.slug },
    company:    { name: preview.company.name, slug: preview.company.slug },
    emailBound: Boolean(preview.email),
  };
}

// ── Management ────────────────────────────────────────────────────────────────

/** Live invites for a production, newest first. Never returns a token. */
export async function listInvites(productionId: string) {
  return db
    .select({
      id:          productionInvites.id,
      email:       productionInvites.email,
      roleId:      productionInvites.roleId,
      roleName:    productionRoles.name,
      expiresAt:   productionInvites.expiresAt,
      maxUses:     productionInvites.maxUses,
      useCount:    productionInvites.useCount,
      lastUsedAt:  productionInvites.lastUsedAt,
      createdAt:   productionInvites.createdAt,
      createdBy:   productionInvites.createdBy,
      inviterName: users.name,
    })
    .from(productionInvites)
    .leftJoin(productionRoles, eq(productionInvites.roleId, productionRoles.id))
    .leftJoin(users, eq(productionInvites.createdBy, users.id))
    .where(and(
      eq(productionInvites.productionId, productionId),
      isNull(productionInvites.revokedAt),
      gt(productionInvites.expiresAt, new Date()),
      or(
        isNull(productionInvites.maxUses),
        sql`${productionInvites.useCount} < ${productionInvites.maxUses}`,
      ),
    ))
    .orderBy(desc(productionInvites.createdAt));
}

/** Revokes in place. Returns false when the invite is not this production's. */
export async function revokeInvite(productionId: string, inviteId: string): Promise<boolean> {
  const [row] = await db
    .update(productionInvites)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(productionInvites.id, inviteId),
      eq(productionInvites.productionId, productionId),
      isNull(productionInvites.revokedAt),
    ))
    .returning({ id: productionInvites.id });

  return Boolean(row);
}
