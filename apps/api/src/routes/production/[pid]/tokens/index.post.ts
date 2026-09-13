import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, apiTokens, productionRoles } from '@starling/db';
import { defineEventHandler, readValidatedBody, createError } from '../../../../lib/handler.js';
import { requireProductionParam } from '../../../../lib/production.js';
import { getClientIp } from '../../../../lib/security.js';
import {
  issueToken, recordTokenEvent, maskTokenPermissions, TOKEN_FORBIDDEN_PERMISSIONS,
} from '../../../../lib/apiTokens.js';
import { Permission, decode } from '@starling/auth/permissions';

const bodySchema = z.object({
  label:  z.string().min(1).max(64),
  roleId: z.uuid(),
});

/**
 * Issues a token. The plaintext is returned HERE and nowhere else, ever.
 *
 * Only the hash is stored, so this response is the single moment the secret
 * exists outside the caller's device. The client is responsible for showing it
 * once and saying plainly that it cannot be recovered.
 */
export default defineEventHandler(async (event) => {
  const ctx = await requireProductionParam(event, { permission: Permission.ADMINISTRATOR });
  const body = await readValidatedBody(event, bodySchema);

  // The role must belong to THIS production — otherwise a token could be minted
  // against a role from somewhere else entirely.
  const [role] = await db.select().from(productionRoles)
    .where(and(eq(productionRoles.id, body.roleId), eq(productionRoles.productionId, ctx.production.id)))
    .limit(1);
  if (!role) throw createError({ statusCode: 404, message: 'Role not found', errorKey: 'errors.role.notFound' });

  // Masked, not refused.
  //
  // Refusing sounds safer and is worse in practice: most productions run a
  // single broad role, so it left operators unable to issue any token at all,
  // with "make a narrower role" as the only hint. They cannot be trusted to
  // guess which bits are safe, and a feature nobody can use gets worked around.
  //
  // What must never happen is masking SILENTLY — an operator who picks an
  // administrator role and is handed something weaker without being told will
  // trust a credential they do not understand. So the dropped permissions are
  // named in the response, the UI states them before the token is created, and
  // the listing shows what each token actually holds.
  const dropped = role.permissions & TOKEN_FORBIDDEN_PERMISSIONS;
  const granted = maskTokenPermissions(role.permissions);

  const issued = issueToken();

  await db.insert(apiTokens).values({
    id:           issued.id,
    productionId: ctx.production.id,
    roleId:       role.id,
    label:        body.label.trim(),
    tokenHash:    issued.tokenHash,
    createdBy:    ctx.auth.userId || null,
    expiresAt:    issued.expiresAt,
  });

  recordTokenEvent({
    tokenId:      issued.id,
    productionId: ctx.production.id,
    event:        'issued',
    actorUserId:  ctx.auth.userId || null,
    ip:           getClientIp(event.req),
    // The dropped bits are part of the record: "what was this token actually
    // given" is the first question anyone asks of an audit log.
    detail:       `issued "${body.label.trim()}" with role "${role.name}"`
                  + (dropped ? ` (withheld: ${decode(dropped).join(', ')})` : ''),
  });

  return {
    token: {
      id:          issued.id,
      label:       body.label.trim(),
      profileImageId: null,
      roleId:      role.id,
      roleName:    role.name,
      roleHue:     role.hue,
      createdBy:   ctx.auth.userId || null,
      createdAt:   new Date(),
      expiresAt:   issued.expiresAt,
      lastUsedAt:  null,
      permissions: granted.toString(),
      withheld:    decode(dropped),
    },
    /** Shown once. Not recoverable. */
    secret: issued.plaintext,
  };
});
