import { eq } from 'drizzle-orm';
import { db, productionRoles } from '@starling/db';
import { decode } from '@starling/auth/permissions';
import { defineEventHandler } from '../../../lib/handler.js';
import { requireProductionParam } from '../../../lib/production.js';
import { trackActivity } from '../../../lib/activity.js';

export default defineEventHandler(async (event) => {
  const { auth, company, production, privileged, memberRoleId } = await requireProductionParam(event);

  // Same signal as /production/find, for clients that already hold the id.
  trackActivity({
    userId:       auth.userId,
    entityType:   'production',
    entityId:     production.id,
    productionId: production.id,
    companyId:    company.id,
  });

  let permissions: string[] = [];
  if (!privileged && memberRoleId) {
    const [role] = await db
      .select({ permissions: productionRoles.permissions })
      .from(productionRoles)
      .where(eq(productionRoles.id, memberRoleId))
      .limit(1);
    if (role?.permissions) permissions = decode(role.permissions);
  }

  return { company, production, access: { privileged, permissions } };
});
