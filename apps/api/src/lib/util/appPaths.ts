/**
 * Paths into the web app that the API hands out — in emails, and as landing
 * spots after an invite. Kept in one place so they move together with the
 * router in apps/web.
 */

/** A production's dashboard, where anyone who just joined it should land. */
export function productionPath(companySlug: string, productionSlug: string): string {
  return `/c/${companySlug}/p/${productionSlug}/dashboard`;
}
