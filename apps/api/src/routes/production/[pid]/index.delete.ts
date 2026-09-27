import { eq } from 'drizzle-orm';
import { db, productions } from '@starling/db';
import { defineEventHandler } from '../../../lib/http/handler.js';
import { requireProductionParam } from '../../../lib/access/production.js';
import { Permission } from '@starling/auth/permissions';
import { deleteProductionStorage } from '../../../lib/storage.js';

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event, { permission: Permission.ADMINISTRATOR });

  await deleteProductionStorage(production.id);
  await db.delete(productions).where(eq(productions.id, production.id));

  return { deleted: production.id, slug: production.slug };
});
