import { eq } from 'drizzle-orm';
import { db, emailVerifications, users } from '@starling/db';
import { mintSecret, hashSecret } from '../auth/secrets.js';

/**
 * "Confirm your email address" links.
 *
 * Same shape as invites.ts, and for the same reasons: the token is 32 bytes
 * from a CSPRNG stored only as a SHA-256, so a database dump cannot be replayed
 * and there is nothing to slow an attacker down that entropy has not already
 * handled.
 */

/** Long enough to survive a night in an inbox, short enough to mean something. */
export const VERIFICATION_TTL_HOURS = 24;

export function verificationUrlPath(token: string): string {
  return `/verify-email/${token}`;
}

/**
 * Issues a link for the user's CURRENT address, discarding any earlier ones.
 *
 * Replacing rather than accumulating means "send it again" cannot leave three
 * live links from three different days, and the one in the newest mail is
 * always the one that works.
 */
export async function issueVerification(user: { id: string; email: string }): Promise<string> {
  const token = mintSecret();

  await db.delete(emailVerifications).where(eq(emailVerifications.userId, user.id));

  await db.insert(emailVerifications).values({
    userId:    user.id,
    email:     user.email,
    tokenHash: hashSecret(token),
    expiresAt: new Date(Date.now() + VERIFICATION_TTL_HOURS * 60 * 60 * 1000),
  });

  return token;
}

export type VerificationRejection = 'notFound' | 'expired' | 'emailChanged';

export type VerificationResult =
  | { ok: true;  email: string; alreadyVerified: boolean }
  | { ok: false; reason: VerificationRejection };

/**
 * Consumes a token and marks the address verified.
 *
 * The row is deleted whatever the outcome of the check that follows it — a
 * confirmation link is single-use by definition, and one that stays live after
 * being clicked is just a credential sitting in an inbox.
 */
export async function verifyEmailToken(token: string): Promise<VerificationResult> {
  if (!token) return { ok: false, reason: 'notFound' };

  const [row] = await db
    .select({ verification: emailVerifications, user: users })
    .from(emailVerifications)
    .innerJoin(users, eq(emailVerifications.userId, users.id))
    .where(eq(emailVerifications.tokenHash, hashSecret(token)))
    .limit(1);

  if (!row) return { ok: false, reason: 'notFound' };

  await db.delete(emailVerifications).where(eq(emailVerifications.id, row.verification.id));

  if (row.verification.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };

  // The address moved on after the link was sent. This token proves the old
  // one, which says nothing about whoever holds the new one.
  if (row.verification.email !== row.user.email) return { ok: false, reason: 'emailChanged' };

  if (row.user.isEmailVerified) return { ok: true, email: row.user.email, alreadyVerified: true };

  await db.update(users).set({ isEmailVerified: true }).where(eq(users.id, row.user.id));

  return { ok: true, email: row.user.email, alreadyVerified: false };
}
