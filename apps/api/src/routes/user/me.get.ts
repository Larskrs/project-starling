import { eq } from 'drizzle-orm';
import { db, users } from '@starling/db';
import { defineEventHandler, requireAuth, ApiError } from '../../lib/handler.js';

export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event);

  const [user] = await db
    .select({
      id:              users.id,
      email:           users.email,
      name:            users.name,
      first_name:      users.first_name,
      last_name:       users.last_name,
      isEmailVerified: users.isEmailVerified,
      role:            users.role,
      avatarImageId:   users.avatarImageId,
      bannerImageId:   users.bannerImageId,
    })
    .from(users)
    .where(eq(users.id, auth.userId))
    .limit(1);

  if (!user) throw new ApiError(404, 'User not found');

  return user;
});
