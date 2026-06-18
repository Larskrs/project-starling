import { db, companies } from '@starling/db';
import { defineEventHandler, requireAuth } from '../../lib/handler.js';

export default defineEventHandler(async (event) => {
  await requireAuth(event);

  const companyList = (await db.select().from(companies).orderBy(companies.createdAt)).reverse();
  return { companyList };
});
