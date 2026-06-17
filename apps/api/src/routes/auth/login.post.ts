import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, users } from '@starling/db';
import { defineEventHandler, readValidatedBody, ApiError } from '../../lib/handler.js';
import { verifyPassword } from '../../lib/auth.js';
import { createSession, SESSION_COOKIE, SESSION_TTL_SEC } from '../../lib/session.js';

const schema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

export default defineEventHandler(async (event) => {
  const { email, password } = await readValidatedBody(event, schema);

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (!user || !(await verifyPassword(password, user.hashedPassword))) {
    throw new ApiError(401, 'Invalid email or password');
  }

  
  const sessionId = await createSession(user.id);
  
  console.log(`User ${user.email} logged in`);

  event.res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}; Path=/`,
  );

  return {
    user: {
      id:              user.id,
      email:           user.email,
      name:            user.name,
      role:            user.role,
    },
  };
});
