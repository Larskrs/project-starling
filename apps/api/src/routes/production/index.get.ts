import { companies, db, productions } from '@starling/db';
import { createError, defineEventHandler, getValidatedQuery, requireAuth } from '../../lib/handler.js';
import z from 'zod';
import { and, eq } from 'drizzle-orm';

const querySchema = z.object({
  cid: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24).transform(String),
}); 

export default defineEventHandler(async (event) => {
  await requireAuth(event);

  const { cid, limit } =  getValidatedQuery(event, querySchema)

  if (cid) {
    const company = await db.select().from(companies).where(eq(companies.id, cid));
    if (company.length === 0) throw createError({ statusCode: 404, message: `Company not found`})
  }

  const productionList = (await db.select().from(productions)
  .where(and(
    cid ? eq(productions.companyId, cid) : undefined
  ))
  .orderBy(productions.createdAt)).reverse();
  return productionList;
});
