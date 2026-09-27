import { defineEventHandler, getRouterParam, createError } from '../../../../lib/http/handler.js';
import { requireProductionParam } from '../../../../lib/access/production.js';
import { revokeInvite } from '../../../../lib/access/invites.js';
import { Permission } from '@starling/auth/permissions';

/**
 * Withdraws an invite. The row stays, marked revoked, so a link that is already
 * in someone's inbox stops working without erasing the record that it existed.
 */
export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event, { permission: Permission.MANAGE_MEMBERS });

  const inviteId = getRouterParam(event, 'inviteId');
  if (!inviteId) throw createError({ statusCode: 400, message: 'Missing invite id' });

  const revoked = await revokeInvite(production.id, inviteId);
  if (!revoked) throw createError({ statusCode: 404, message: 'Invite not found', errorKey: 'errors.invite.notFound' });

  return { revoked: true };
});
