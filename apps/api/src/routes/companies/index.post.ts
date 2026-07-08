import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { companies, companyMembers, db } from '@starling/db';
import { defineEventHandler, readValidatedBody, ApiError, requireAdmin } from '../../lib/handler.js';

const schema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers, and hyphens'),
});

export default defineEventHandler(async (event) => {
  const auth = await requireAdmin(event);

  const { name, slug } = await readValidatedBody(event, schema);

  const [existing] = await db.select({ id: companies.id }).from(companies).where(eq(companies.slug, slug)).limit(1);
  if (existing) throw new ApiError(409, 'A company with that slug already exists');

  const [company] = await db.insert(companies).values({ name, slug }).returning();
  await db.insert(companyMembers).values({ companyId: company.id, userId: auth.userId, role: 'owner' });
  return { company };
});
