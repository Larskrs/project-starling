import z from 'zod';
import { eq } from 'drizzle-orm';
import { db, productionRoles } from '@starling/db';
import { decode } from '@starling/auth/permissions';
import { defineEventHandler, getValidatedQuery } from '../../lib/handler.js';
import { requireProductionAccess } from '../../lib/production.js';
import { trackActivity } from '../../lib/activity.js';

const querySchema = z.object({
  cslug: z.string().min(1),
  pslug: z.string().min(1),
});

// Slug → production lookup for initial page loads; everything else addresses
// the production by id (/api/productions/[id], ?pid=…).
export default defineEventHandler(async (event) => {
  const { cslug, pslug } = getValidatedQuery(event, querySchema);

  const { auth, company, production, privileged, memberRoleId } = await requireProductionAccess(event, { cslug, pslug });

  // This route only runs when a production page is opened by URL — the
  // "recently opened projects" signal.
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
