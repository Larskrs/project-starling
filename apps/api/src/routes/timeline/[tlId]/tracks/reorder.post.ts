import z from 'zod';
import { eq } from 'drizzle-orm';
import { db, tracks } from '@starling/db';
import { defineEventHandler, readValidatedBody, createError } from '../../../../lib/handler.js';
import { requireTimelineParam } from '../../../../lib/production.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  order: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * Rewrites track sortOrder to match the given id order (index = sortOrder).
 * Ids that don't belong to the timeline are ignored, and tracks missing from
 * the list keep their old sortOrder — lenient so a concurrent add/delete by
 * another editor doesn't fail the whole reorder.
 */
export default defineEventHandler(async (event) => {
  const { timeline } = await requireTimelineParam(event, { permission: Permission.EDIT_TIMELINE });
  const body = await readValidatedBody(event, bodySchema);

  const rows  = await db.select({ id: tracks.id }).from(tracks).where(eq(tracks.timelineId, timeline.id));
  const valid = new Set(rows.map(r => r.id));
  const order = [...new Set(body.order)].filter(id => valid.has(id));
  if (order.length === 0) throw createError({ statusCode: 422, message: 'No matching tracks' });

  await db.transaction(async (tx) => {
    for (let i = 0; i < order.length; i++) {
      await tx.update(tracks).set({ sortOrder: i }).where(eq(tracks.id, order[i]!));
    }
  });

  return { order };
});
