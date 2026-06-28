import { eq } from 'drizzle-orm';
import { db, users, sessions } from '@starling/db';
import { defineEventHandler, ApiError } from '../../lib/handler.js';
import { parseSessionCookie } from '../../lib/session.js';

export default defineEventHandler(async (event) => {
  const sessionId = parseSessionCookie(event.req.headers.cookie);
  if (!sessionId) throw new ApiError(401, 'Not authenticated');

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!session)                        throw new ApiError(401, 'Session not found');
  if (session.expiresAt < new Date())  throw new ApiError(401, 'Session expired');

  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name, first_name: users.first_name, last_name: users.last_name, isEmailVerified: users.isEmailVerified, role: users.role, avatarImageId: users.avatarImageId, bannerImageId: users.bannerImageId })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (!user) throw new ApiError(401, 'Session refers to a deleted user');

  return { session, user };
});
