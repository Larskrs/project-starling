import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { db, activity } from '@starling/db';
import { TtlCache } from './cache.js';

export type ActivityEntity = (typeof activity.$inferSelect)['entityType'];
export type ActivityAction = (typeof activity.$inferSelect)['action'];

export interface ActivityInput {
  userId:        string;
  entityType:    ActivityEntity;
  entityId:      string;
  /** Defaults to 'open' — the only action the recents lists read today. */
  action?:       ActivityAction;
  productionId?: string | null;
  companyId?:    string | null;
  data?:         unknown;
}

/**
 * Repeats of the same user/entity/action inside this window fold onto the
 * existing row instead of appending a new one. Long enough that a session of
 * scrubbing one timeline stays a single row; short enough that "recently
 * opened" still reflects a genuine return visit.
 */
const COALESCE_WINDOW_MS = 30 * 60 * 1000;

/**
 * Writes are already cheap, but socket reconnects and the editor's bootstrap
 * fetch can fire within seconds of each other. This skips the DB round-trip
 * entirely for a repeat inside the window — the row's `occurredAt` is at most
 * this stale, which "recently opened" cannot perceive.
 */
const DEDUPE_TTL_MS = 60 * 1000;
const recent = new TtlCache<string, true>(DEDUPE_TTL_MS, 5000);

function key(input: ActivityInput): string {
  return `${input.userId}:${input.entityType}:${input.entityId}:${input.action ?? 'open'}`;
}

/**
 * Appends to the activity log, coalescing onto a recent matching row.
 *
 * Callers should treat this as fire-and-forget (see `trackActivity`): activity
 * is a side effect of a request, never its purpose, so a failure here must not
 * surface to the user.
 */
export async function recordActivity(input: ActivityInput): Promise<void> {
  const action = input.action ?? 'open';
  const cacheKey = key(input);
  if (recent.get(cacheKey)) return;
  recent.set(cacheKey, true);

  // Bump the newest matching row if it is still inside the window. A race
  // between two calls can leave two rows — harmless, readers aggregate.
  const [existing] = await db
    .select({ id: activity.id })
    .from(activity)
    .where(and(
      eq(activity.userId, input.userId),
      eq(activity.entityType, input.entityType),
      eq(activity.entityId, input.entityId),
      eq(activity.action, action),
      gt(activity.occurredAt, new Date(Date.now() - COALESCE_WINDOW_MS)),
    ))
    .orderBy(desc(activity.occurredAt))
    .limit(1);

  if (existing) {
    await db
      .update(activity)
      .set({ occurredAt: new Date(), count: sql`${activity.count} + 1` })
      .where(eq(activity.id, existing.id));
    return;
  }

  await db.insert(activity).values({
    userId:       input.userId,
    entityType:   input.entityType,
    entityId:     input.entityId,
    action,
    productionId: input.productionId ?? null,
    companyId:    input.companyId ?? null,
    data:         input.data ?? null,
  });
}

/**
 * Fire-and-forget `recordActivity`. Logging must never delay a response or
 * turn a working request into a 500, so the promise is deliberately not
 * awaited and errors are swallowed.
 */
export function trackActivity(input: ActivityInput): void {
  void recordActivity(input).catch((err) => {
    console.warn('[activity] failed to record', err);
  });
}
