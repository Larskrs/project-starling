import { eq, desc, and } from 'drizzle-orm';
import { db, storageFiles, productionMembers, productionRoles, users } from '@starling/db';
import { defineEventHandler } from '../../../lib/handler.js';
import { requireProductionParam } from '../../../lib/production.js';

export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event);

  const [recentFiles, recentMembers] = await Promise.all([
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
  ]);

  return {
    recentFiles:   recentFiles.map(f => ({ ...f, uploader: f.uploader?.id ? f.uploader : null })),
    recentMembers: recentMembers.map(m => ({ ...m, role: m.role?.id ? m.role : null })),
  };
});
