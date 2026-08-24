import { eq } from 'drizzle-orm';
import { db, users } from '@starling/db';
import { defineEventHandler, requireAuth, ApiError } from '../../lib/handler.js';
import { publicUserColumns } from '../../lib/user.js';

export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event);

  const [user] = await db
    .select(publicUserColumns)
    .from(users)
    .where(eq(users.id, auth.userId))
    .limit(1);

  if (!user) throw new ApiError(404, 'User not found');

  return user;
});
