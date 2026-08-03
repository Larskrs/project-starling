import z from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, activity, timelines, productions, companies } from '@starling/db';
import { defineEventHandler, getValidatedQuery, requireAuth } from '../../lib/handler.js';
import { productionAccessFilter } from '../../lib/production.js';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(24).default(6),
});

/**
 * The caller's recently opened timelines and productions, newest first.
 *
 * Access is re-checked at read time through the same filter /production/list
 * uses — a log row survives losing membership, the listing must not.
 * Rows for deleted entities drop out via the inner joins.
 */
export default defineEventHandler(async (event) => {
  const auth    = await requireAuth(event);
  const { limit } = getValidatedQuery(event, querySchema);

  const accessFilter = await productionAccessFilter(auth);
  if (accessFilter === null) return { timelines: [], productions: [] };

  // One log row per user/entity is the norm (recordActivity coalesces), but a
  // return visit after the window appends another — aggregate to be certain
  // each entity appears once.
  // mapWith borrows the column's driver decoder, so the aggregate comes back as
  // a Date (→ ISO with a Z on the wire) instead of Postgres' bare
  // "YYYY-MM-DD HH:MM:SS" text, which JS would otherwise read as local time.
  const lastOpenedAt = sql`max(${activity.occurredAt})`
    .mapWith(activity.occurredAt)
    .as('last_opened_at');
  const openedBy = and(
    eq(activity.userId, auth.userId),
    eq(activity.action, 'open'),
  );

  const [timelineRows, productionRows] = await Promise.all([
    db.select({
      id:             timelines.id,
      name:           timelines.name,
      profileImageId: timelines.profileImageId,
      frameRate:      timelines.frameRate,
      startFrame:     timelines.startFrame,
      endFrame:       timelines.endFrame,
      productionId:   productions.id,
      productionName: productions.name,
      productionSlug: productions.slug,
      // The owning production's image, for clients that want to show both.
      productionImageId: productions.profileImageId,
      companyName:    companies.name,
      companySlug:    companies.slug,
      lastOpenedAt,
    })
      .from(activity)
      .innerJoin(timelines,   eq(activity.entityId, timelines.id))
      .innerJoin(productions, eq(timelines.productionId, productions.id))
      .innerJoin(companies,   eq(productions.companyId, companies.id))
      .where(and(openedBy, eq(activity.entityType, 'timeline'), accessFilter))
      // Grouping by each table's primary key lets the other selected columns
      // ride along (Postgres functional dependency).
      .groupBy(timelines.id, productions.id, companies.id)
      .orderBy(desc(lastOpenedAt))
      .limit(limit),

    db.select({
      id:             productions.id,
      name:           productions.name,
      slug:           productions.slug,
      profileImageId: productions.profileImageId,
      bannerImageId:  productions.bannerImageId,
      companyId:      companies.id,
      companyName:    companies.name,
      companySlug:    companies.slug,
      lastOpenedAt,
    })
      .from(activity)
      .innerJoin(productions, eq(activity.entityId, productions.id))
      .innerJoin(companies,   eq(productions.companyId, companies.id))
      .where(and(openedBy, eq(activity.entityType, 'production'), accessFilter))
      .groupBy(productions.id, companies.id)
      .orderBy(desc(lastOpenedAt))
      .limit(limit),
  ]);

  return { timelines: timelineRows, productions: productionRows };
});
