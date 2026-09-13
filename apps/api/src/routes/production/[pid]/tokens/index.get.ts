import { defineEventHandler } from '../../../../lib/handler.js';
import { requireProductionParam } from '../../../../lib/production.js';
import { listProductionTokens, TOKEN_TTL_DAYS } from '../../../../lib/apiTokens.js';
import { Permission } from '@starling/auth/permissions';

/**
 * Live tokens for a production.
 *
 * Never returns a hash and never returns a secret — there is nothing here that
 * could be replayed as a credential. Revoked tokens are omitted; their history
 * stays in the audit log.
 */
export default defineEventHandler(async (event) => {
  const { production } = await requireProductionParam(event, { permission: Permission.ADMINISTRATOR });

  const tokens = await listProductionTokens(production.id);

  return { tokens, ttlDays: TOKEN_TTL_DAYS };
});
