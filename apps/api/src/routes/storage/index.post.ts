import z from 'zod';
import { eq } from 'drizzle-orm';
import { db, companies, storageFolders } from '@starling/db';
import { defineEventHandler, readValidatedBody, createError, requireAuth } from '../../lib/handler.js';

const schema = z.object({
  company_id: z.uuid(),
  name:       z.string().min(1).max(200),
  parent_id:  z.uuid().optional().nullable(),
  hue:        z.number().int().min(0).max(360).optional().nullable(),
});

export default defineEventHandler(async (event) => {
  await requireAuth(event);

  const { company_id, name, parent_id, hue } = await readValidatedBody(event, schema);

  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, company_id)).limit(1);
  if (!company) throw createError({ statusCode: 404, message: 'Company not found' });

  if (parent_id) {
    const [parent] = await db.select({ id: storageFolders.id, companyId: storageFolders.companyId })
      .from(storageFolders).where(eq(storageFolders.id, parent_id)).limit(1);
    if (!parent)                          throw createError({ statusCode: 404, message: 'Parent folder not found' });
    if (parent.companyId !== company_id)  throw createError({ statusCode: 403, message: 'Parent folder belongs to a different company' });
  }

  const [folder] = await db.insert(storageFolders).values({ companyId: company_id, name, parentId: parent_id, hue: hue ?? null }).returning();
  return { folder };
});
