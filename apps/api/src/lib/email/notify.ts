import { eq } from 'drizzle-orm';
import { db, companies } from '@starling/db';
import { appUrl, sendMail } from './mailer.js';
import { productionPath } from '../util/appPaths.js';
import { loadInlineImage } from './images.js';
import { productionInvite, productionJoinInvite, companyInvite, verifyEmail } from './templates.js';
import type { Locale, RenderedMail } from './layout.js';

/**
 * The invite emails, as one call from a route.
 *
 * Each is fire-and-forget on purpose, the same bargain as `trackActivity`:
 * telling someone they were added is a side effect of the add, so a mail server
 * that is down must never fail a membership that is already committed. Keeping
 * the image lookup inside the un-awaited promise also keeps a disk read and a
 * PNG re-encode off the request's critical path.
 */

/**
 * The company's profile image, looked up only when the more specific image is
 * missing. Runs inside the queued work, so the request never waits for it.
 */
async function companyImageId(companyId: string | undefined): Promise<string | null> {
  if (!companyId) return null;
  const [row] = await db
    .select({ profileImageId: companies.profileImageId })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  return row?.profileImageId ?? null;
}

/**
 * Loads the inline image, renders with its content-id, sends — all off the
 * request. `resolveImageId` runs inside the queued work for the same reason.
 */
function queueWithImage(
  what:           string,
  to:             string,
  resolveImageId: () => Promise<string | null | undefined>,
  render:         (imageCid: string | null) => RenderedMail,
): void {
  void (async () => {
    const image = await loadInlineImage(await resolveImageId());
    const mail  = render(image?.cid ?? null);
    await sendMail({ to, ...mail, ...(image ? { attachments: [image] } : {}) });
  })().catch((err) => {
    console.warn(`[mail] failed to send ${what} to ${to}:`, err);
  });
}

export interface ProductionInviteMail {
  to:             string;
  /** Usually a first name — "Lars". Absent when an API token added them. */
  inviterName?:   string;
  productionName: string;
  companyName:    string;
  companySlug:    string;
  productionSlug: string;
  /** The production's own image, when it has one. */
  imageFileId?:   string | null;
  /** Used to fall back to the company's image when the production has none. */
  companyId?:     string;
  locale?:        Locale;
}

export function queueProductionInvite(input: ProductionInviteMail): void {
  queueWithImage(
    'production invite',
    input.to,
    async () => input.imageFileId ?? companyImageId(input.companyId),
    (imageCid) => productionInvite({
      inviterName:    input.inviterName,
      productionName: input.productionName,
      companyName:    input.companyName,
      url:            appUrl(productionPath(input.companySlug, input.productionSlug)),
      imageCid,
      locale:         input.locale,
    }),
  );
}

/**
 * The confirm-your-address email.
 *
 * Awaited by its caller rather than queued: this one is the entire point of the
 * request that triggers it, so "we've sent it" must not be said before the mail
 * server has taken it.
 */
export async function sendEmailVerification(input: {
  to:             string;
  url:            string;
  expiresInHours: number;
  locale?:        Locale;
}): Promise<void> {
  const mail = verifyEmail({
    url:            input.url,
    expiresInHours: input.expiresInHours,
    locale:         input.locale,
  });

  await sendMail({ to: input.to, ...mail });
}

export interface ProductionJoinInviteMail {
  to:             string;
  inviterName?:   string;
  productionName: string;
  companyName:    string;
  /** The full one-time link, already built — it carries the secret token. */
  url:            string;
  expiresInHours: number;
  imageFileId?:   string | null;
  companyId?:     string;
  locale?:        Locale;
}

/** The invite for someone with no account yet — carries a one-time token. */
export function queueProductionJoinInvite(input: ProductionJoinInviteMail): void {
  queueWithImage(
    'join invite',
    input.to,
    async () => input.imageFileId ?? companyImageId(input.companyId),
    (imageCid) => productionJoinInvite({
      inviterName:    input.inviterName,
      productionName: input.productionName,
      companyName:    input.companyName,
      url:            input.url,
      expiresInHours: input.expiresInHours,
      imageCid,
      locale:         input.locale,
    }),
  );
}

export interface CompanyInviteMail {
  to:           string;
  inviterName?: string;
  companyName:  string;
  companySlug:  string;
  role:         'admin' | 'member';
  imageFileId?: string | null;
  locale?:      Locale;
}

export function queueCompanyInvite(input: CompanyInviteMail): void {
  queueWithImage(
    'company invite',
    input.to,
    async () => input.imageFileId,
    (imageCid) => companyInvite({
      inviterName: input.inviterName,
      companyName: input.companyName,
      role:        input.role,
      url:         appUrl(`/c/${input.companySlug}`),
      imageCid,
      locale:      input.locale,
    }),
  );
}
