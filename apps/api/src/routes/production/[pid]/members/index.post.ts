import z from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, productionMembers, users } from '@starling/db';
import { defineEventHandler, readValidatedBody, createError, ApiError } from '../../../../lib/http/handler.js';
import { requireProductionParam, assertRoleInProduction } from '../../../../lib/access/production.js';
import { userDisplayName, userEmailIs } from '../../../../lib/auth/user.js';
import { appUrl } from '../../../../lib/email/mailer.js';
import { queueProductionInvite, queueProductionJoinInvite } from '../../../../lib/email/notify.js';
import { issueInvite, inviteUrlPath, inviteLimiter, EMAIL_INVITE_TTL_HOURS } from '../../../../lib/access/invites.js';
import { Permission } from '@starling/auth/permissions';

const bodySchema = z.object({
  email:  z.string().email(),
  roleId: z.uuid().optional(),
});

export default defineEventHandler(async (event) => {
  const { production, company, auth } = await requireProductionParam(event, { permission: Permission.MANAGE_MEMBERS });

  const body = await readValidatedBody(event, bodySchema);
  await assertRoleInProduction(production.id, body.roleId);

  const [user] = await db.select({ id: users.id }).from(users).where(userEmailIs(body.email)).limit(1);

  // No account yet: mail them a one-time link that both creates the account and
  // joins them, instead of the dead end this used to be.
  if (!user) {
    // This mails an address nobody has vouched for, so it draws on the same
    // budget as the invites route — otherwise this is the way around it.
    if (!inviteLimiter.check(auth.userId)) {
      throw new ApiError(429, 'Too many invites — try again later', undefined, 'errors.generic.rateLimited');
    }

    const { invite, token } = await issueInvite({
      productionId: production.id,
      roleId:       body.roleId ?? null,
      email:        body.email,
      createdBy:    auth.userId || null,
    });

    queueProductionJoinInvite({
      to:             invite.email!,
      inviterName:    await userDisplayName(auth.userId),
      productionName: production.name,
      companyName:    company.name,
      url:            appUrl(inviteUrlPath(token)),
      expiresInHours: EMAIL_INVITE_TTL_HOURS,
      imageFileId:    production.profileImageId,
      companyId:      company.id,
    });

    event.res.statusCode = 202;
    return { invited: true, email: invite.email, expiresAt: invite.expiresAt };
  }

  const [existing] = await db.select({ id: productionMembers.id })
    .from(productionMembers)
    .where(and(eq(productionMembers.productionId, production.id), eq(productionMembers.userId, user.id)))
    .limit(1);
  if (existing) throw createError({ statusCode: 409, message: 'User is already a member' });

  const [member] = await db.insert(productionMembers).values({
    productionId: production.id,
    userId:       user.id,
    roleId:       body.roleId ?? null,
  }).returning();

  // Telling someone they were added is a side effect of the add, so it is
  // queued rather than awaited: a mail server that is down must not fail a
  // membership that is already committed.
  if (user.id !== auth.userId) {
    // Locale is the app default until users carry one of their own.
    queueProductionInvite({
      to:             body.email,
      inviterName:    await userDisplayName(auth.userId),
      productionName: production.name,
      companyName:    company.name,
      companySlug:    company.slug,
      productionSlug: production.slug,
      // The production's own image is the more specific picture of what they
      // were invited to; the company's stands in when it has none.
      imageFileId:    production.profileImageId,
      companyId:      company.id,
    });
  }

  return member;
});
