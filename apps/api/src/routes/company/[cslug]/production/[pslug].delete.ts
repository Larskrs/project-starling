import { eq } from 'drizzle-orm';
import { db, productions } from '@starling/db';
import { defineEventHandler, getRouterParam, createError } from '../../../../lib/handler.js';
import { requireProductionAccess, requirePermission } from '../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';
import { deleteProductionStorage } from '../../../../lib/storage.js';

export default defineEventHandler(async (event) => {
  const cslug = getRouterParam(event, 'cslug');
  const pslug = getRouterParam(event, 'pslug');
  if (!cslug || !pslug) throw createError({ statusCode: 400, message: 'Missing slugs' });

  const ctx = await requireProductionAccess(event, { cslug, pslug });
  await requirePermission(ctx, Permission.ADMINISTRATOR);

  await deleteProductionStorage(ctx.production.id);
  await db.delete(productions).where(eq(productions.id, ctx.production.id));

  return { deleted: ctx.production.id, slug: ctx.production.slug };
});
