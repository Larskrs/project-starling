import z from 'zod';
import { defineEventHandler, readValidatedBody, ApiError } from '../../../../lib/http/handler.js';
import { requireProductionParam, assertRoleInProduction } from '../../../../lib/access/production.js';
import { userDisplayName } from '../../../../lib/auth/user.js';
import { appUrl } from '../../../../lib/email/mailer.js';
import { queueProductionJoinInvite } from '../../../../lib/email/notify.js';
import {
  issueInvite, inviteUrlPath, inviteLimiter, EMAIL_INVITE_TTL_HOURS, LINK_INVITE_TTL_HOURS, MAX_INVITE_TTL_HOURS,
} from '../../../../lib/access/invites.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  /** Set to mail a one-time invite; omit for a shareable link. */
  email:          z.string().email().optional(),
  roleId:         z.uuid().optional(),
  expiresInHours: z.number().int().min(1).max(MAX_INVITE_TTL_HOURS).optional(),
  /** Link invites only — an emailed invite is always single-use. */
  maxUses:        z.number().int().min(1).max(1000).optional(),
});

export default defineEventHandler(async (event) => {
  const { production, company, auth } = await requireProductionParam(event, { permission: Permission.MANAGE_MEMBERS });

  const body = await readValidatedBody(event, bodySchema);

  if (!inviteLimiter.check(auth.userId)) {
    throw new ApiError(429, 'Too many invites — try again later', undefined, 'errors.generic.rateLimited');
  }

  await assertRoleInProduction(production.id, body.roleId);

  const { invite, token } = await issueInvite({
    productionId:   production.id,
    roleId:         body.roleId ?? null,
    email:          body.email ?? null,
    createdBy:      auth.userId || null,
    expiresInHours: body.expiresInHours,
    maxUses:        body.maxUses ?? null,
  });

  const url = appUrl(inviteUrlPath(token));

  if (invite.email) {
    queueProductionJoinInvite({
      to:             invite.email,
      inviterName:    await userDisplayName(auth.userId),
      productionName: production.name,
      companyName:    company.name,
      url,
      expiresInHours: body.expiresInHours ?? EMAIL_INVITE_TTL_HOURS,
      imageFileId:    production.profileImageId,
      companyId:      company.id,
    });
  }

  event.res.statusCode = 201;

  return {
    invite: {
      id:        invite.id,
      email:     invite.email,
      roleId:    invite.roleId,
      expiresAt: invite.expiresAt,
      maxUses:   invite.maxUses,
      useCount:  invite.useCount,
      createdAt: invite.createdAt,
    },
    /**
     * The only time the token is ever returned. An emailed invite has already
     * been sent; a link invite exists purely so the caller can copy it.
     */
    url,
    defaultExpiryHours: invite.email ? EMAIL_INVITE_TTL_HOURS : LINK_INVITE_TTL_HOURS,
  };
});
