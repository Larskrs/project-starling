import z from 'zod';
import { eq, and, ne } from 'drizzle-orm';
import { db, storageFiles } from '@starling/db';
import { defineEventHandler, getValidatedQuery } from '../../../lib/handler.js';
import { requireProductionParam } from '../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const querySchema = z.object({
  type: z.enum(['audio', 'image']).optional(),
});

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event, { permission: Permission.VIEW });

  const { type } = getValidatedQuery(event, querySchema);

  const conditions = [
    eq(storageFiles.productionId, production.id),
    ne(storageFiles.hidden, true),
  ];
  if (type) conditions.push(eq(storageFiles.type, type));

  const files = await db.select({
    id:       storageFiles.id,
    name:     storageFiles.name,
    mimeType: storageFiles.mimeType,
    size:     storageFiles.size,
    type:     storageFiles.type,
  }).from(storageFiles)
    .where(and(...conditions))
    .orderBy(storageFiles.name);

  return files;
});
