import { companies, db, productions } from '@starling/db';
import { createError, defineEventHandler, getValidatedQuery, requireAuth } from '../../lib/handler.js';
import { productionAccessFilter } from '../../lib/production.js';
import z from 'zod';
import { and, eq } from 'drizzle-orm';

const querySchema = z.object({
  cid:   z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});

export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event);
  const { cid } = getValidatedQuery(event, querySchema);

  if (cid) {
    const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, cid)).limit(1);
    if (!company) throw createError({ statusCode: 404, message: 'Company not found' });
  }

  const accessFilter = await productionAccessFilter(auth);
  if (accessFilter === null) return [];

  const rows = await db.select().from(productions)
    .where(and(
      cid ? eq(productions.companyId, cid) : undefined,
      accessFilter,
    ))
    .orderBy(productions.createdAt);

  return rows.reverse();
});
