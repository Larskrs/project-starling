import { eq, sql, type SQL } from 'drizzle-orm';
import { db, users } from '@starling/db';

/**
 * The single projection for "the signed-in user".
 *
 * login, register, /auth/me and /user/me each used to select their own subset —
 * login omitted first_name, register omitted avatarImageId, only /auth/me had
 * createdAt — while the client typed all four as one `User`. So whether
 * `user.first_name` was a string or undefined depended on which endpoint had
 * most recently populated the store, and the type said nothing about it.
 *
 * Keep this in step with the `User` interface in @starling/auth: that interface
 * is the client's view of exactly this shape.
 *
 * hashedPassword is not here, and must never be.
 */
export const publicUserColumns = {
  id:              users.id,
  email:           users.email,
  name:            users.name,
  first_name:      users.first_name,
  last_name:       users.last_name,
  isEmailVerified: users.isEmailVerified,
  role:            users.role,
  avatarImageId:   users.avatarImageId,
  bannerImageId:   users.bannerImageId,
  createdAt:       users.createdAt,
} as const;

/** The same shape, narrowed from a row already in hand (login/register). */
export function toPublicUser(row: typeof users.$inferSelect) {
  return {
    id:              row.id,
    email:           row.email,
    name:            row.name,
    first_name:      row.first_name,
    last_name:       row.last_name,
    isEmailVerified: row.isEmailVerified,
    role:            row.role,
    avatarImageId:   row.avatarImageId,
    bannerImageId:   row.bannerImageId,
    createdAt:       row.createdAt,
  };
}

export type PublicUser = ReturnType<typeof toPublicUser>;

/**
 * How a person is named in someone else's inbox — "Lars from Cino invited you".
 * First name when set, the full name otherwise; undefined when there is no such
 * user (an API token did the adding), so templates fall back to "Someone".
 */
export async function userDisplayName(userId: string | null | undefined): Promise<string | undefined> {
  if (!userId) return undefined;
  const [row] = await db
    .select({ firstName: users.first_name, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.firstName || row?.name || undefined;
}

/** How an address is stored and compared: trimmed and lowercased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * WHERE clause matching an account by address, ignoring case.
 *
 * Compared through lower() rather than eq() because accounts registered before
 * addresses were normalised may still be stored mixed-case — "Bob@x.com" must
 * find the "bob@x.com" account, not fall through to "no such user".
 */
export function userEmailIs(email: string): SQL {
  return sql`lower(${users.email}) = ${normalizeEmail(email)}`;
}
