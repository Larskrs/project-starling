import { eq, desc, and, sql } from 'drizzle-orm';
import {
  db, storageFiles, productionMembers, productionRoles, users, timelines, tracks,
} from '@starling/db';
import { defineEventHandler } from '../../../lib/handler.js';
import { requireProductionParam } from '../../../lib/production.js';

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event);

  const [recentFiles, recentMembers, recentTimelines, timelineCount, memberCount, fileCount] =
    await Promise.all([
      db
        .select({
          id:        storageFiles.id,
          name:      storageFiles.name,
          type:      storageFiles.type,
          size:      storageFiles.size,
          createdAt: storageFiles.createdAt,
          uploader: {
            id:        users.id,
            firstName: users.first_name,
            lastName:  users.last_name,
            name:      users.name,
          },
        })
        .from(storageFiles)
        .leftJoin(users, eq(storageFiles.userId, users.id))
        .where(and(eq(storageFiles.productionId, production.id), eq(storageFiles.hidden, false)))
        .orderBy(desc(storageFiles.createdAt))
        .limit(5),

      db
        .select({
          id:        productionMembers.id,
          createdAt: productionMembers.createdAt,
          user: {
            id:           users.id,
            firstName:    users.first_name,
            lastName:     users.last_name,
            name:         users.name,
            email:        users.email,
            avatarImageId: users.avatarImageId,
          },
          role: {
            id:   productionRoles.id,
            name: productionRoles.name,
            hue:  productionRoles.hue,
          },
        })
        .from(productionMembers)
        .innerJoin(users, eq(productionMembers.userId, users.id))
        .leftJoin(productionRoles, eq(productionMembers.roleId, productionRoles.id))
        .where(eq(productionMembers.productionId, production.id))
        .orderBy(desc(productionMembers.createdAt))
        .limit(5),

      // Most recently touched first — the dashboard is a way back into work in
      // progress, not an archive. The track count rides along so a tile can say
      // how much is actually built without a request per timeline.
      db
        .select({
          id:             timelines.id,
          name:           timelines.name,
          profileImageId: timelines.profileImageId,
          frameRate:      timelines.frameRate,
          startFrame:     timelines.startFrame,
          endFrame:       timelines.endFrame,
          updatedAt:      timelines.updatedAt,
          trackCount:     sql<number>`count(${tracks.id})`,
        })
        .from(timelines)
        .leftJoin(tracks, eq(tracks.timelineId, timelines.id))
        .where(eq(timelines.productionId, production.id))
        .groupBy(timelines.id)
        .orderBy(desc(timelines.updatedAt))
        .limit(6),

      // Totals for the header tiles. The lists above are capped, so they can't
      // be counted client-side without under-reporting.
      db.select({ n: sql<number>`count(*)` }).from(timelines)
        .where(eq(timelines.productionId, production.id)),

      db.select({ n: sql<number>`count(*)` }).from(productionMembers)
        .where(eq(productionMembers.productionId, production.id)),

      db.select({ n: sql<number>`count(*)` }).from(storageFiles)
        .where(and(eq(storageFiles.productionId, production.id), eq(storageFiles.hidden, false))),
    ]);

  return {
    recentFiles:   recentFiles.map(f => ({ ...f, uploader: f.uploader?.id ? f.uploader : null })),
    recentMembers: recentMembers.map(m => ({ ...m, role: m.role?.id ? m.role : null })),
    // count() comes back as a bigint, which postgres-js hands over as a string.
    timelines:     recentTimelines.map(tl => ({ ...tl, trackCount: Number(tl.trackCount) })),
    counts: {
      timelines: Number(timelineCount[0]?.n ?? 0),
      members:   Number(memberCount[0]?.n ?? 0),
      files:     Number(fileCount[0]?.n ?? 0),
    },
  };
});
