import { defineEventHandler } from '../../../../lib/http/handler.js';
import { requireProductionParam } from '../../../../lib/access/production.js';
import { listInvites } from '../../../../lib/access/invites.js';
import { Permission } from '@starling/auth/permissions';

/** Live invites for the production. Tokens are never returned — only hashes exist. */
export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event, { permission: Permission.MANAGE_MEMBERS });
  return listInvites(production.id);
});
