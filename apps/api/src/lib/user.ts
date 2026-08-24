import { users } from '@starling/db';

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
