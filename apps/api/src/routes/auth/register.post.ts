import { z } from 'zod';
import { db, users } from '@starling/db';
import { defineEventHandler, readValidatedBody, ApiError } from '../../lib/handler.js';
import { hashPassword } from '../../lib/auth.js';
import { createSession, SESSION_COOKIE, SESSION_TTL_SEC } from '../../lib/session.js';

const schema = z.object({
  email:    z.string().email(),
  name:     z.string().min(1).max(100),
  password: z.string().min(8),
});

export default defineEventHandler(async (event) => {
  const { email, name, password } = await readValidatedBody(event, schema);

  const hashedPassword = await hashPassword(password);

  let user: typeof users.$inferSelect;
  try {
    [user] = await db.insert(users).values({ email, name, hashedPassword }).returning();
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg.code === '23505') throw new ApiError(409, 'Email already in use');
    throw err;
  }

  const sessionId = await createSession(user!.id, 'user');

  event.res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}; Path=/`,
  );

  return {
    user: {
      id:              user!.id,
      email:           user!.email,
      name:            user!.name,
      isAdministrator: user!.isAdministrator,
    },
  };
});
