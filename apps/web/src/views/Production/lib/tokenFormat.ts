/**
 * Formatting for the Integrations page.
 *
 * Lives in .ts rather than inside the .vue file because `apps/web/tsconfig.json`
 * includes only `src/**​/*.ts` — logic in a single-file component is never
 * typechecked. Everything here is pure, so it is also testable by bare node.
 */

const MS_PER_DAY = 86_400_000;

export type ExpiryTone = 'expired' | 'soon' | 'ok';

export interface ExpiryState {
  /** Whole days remaining; negative once expired. */
  days: number;
  tone: ExpiryTone;
}

/**
 * A token warns at seven days, which is the window the integration guide tells
 * integrators to alarm on. Keeping the page and the docs on the same number
 * means an operator and a device never disagree about what "soon" is.
 */
export const EXPIRY_WARN_DAYS = 7;

export function expiryState(expiresAt: string | Date, now: number = Date.now()): ExpiryState {
  const ms = new Date(expiresAt).getTime() - now;
  // Floor, not round: with 6.5 days left the honest answer is 6, because
  // rounding up is how someone plans a rotation a day too late.
  const days = Math.floor(ms / MS_PER_DAY);

  if (ms <= 0) return { days, tone: 'expired' };
  return { days, tone: days < EXPIRY_WARN_DAYS ? 'soon' : 'ok' };
}

/**
 * 'MANAGE_MEMBERS' → 'manageMembers', the i18n key the roles page already uses.
 *
 * The API speaks canonical permission names, the locale files are camelCase.
 * Converting here rather than changing either keeps one vocabulary on the wire
 * and one in the translations, and means both pages label a permission the same
 * way.
 */
export function permissionKey(name: string): string {
  return name.toLowerCase().replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
}

const UNITS: [limitMs: number, divisorMs: number, suffix: string][] = [
  [60_000,        1_000,      's'],
  [3_600_000,     60_000,     'm'],
  [86_400_000,    3_600_000,  'h'],
  [2_592_000_000, 86_400_000, 'd'],
];

/**
 * Compact "how long ago", for the last-used column.
 *
 * Returns null for a token that has never been used, which the page renders as
 * a word rather than a dash — "never used" is the most interesting thing this
 * column can say, and it is how you find a device that was configured wrong at
 * install and has been silent ever since.
 */
export function lastUsedLabel(lastUsedAt: string | Date | null, now: number = Date.now()): string | null {
  if (!lastUsedAt) return null;

  const diff = now - new Date(lastUsedAt).getTime();
  if (diff < 45_000) return 'now';

  for (const [limit, divisor, suffix] of UNITS) {
    if (diff < limit) return `${Math.floor(diff / divisor)}${suffix}`;
  }
  return `${Math.floor(diff / 2_592_000_000)}mo`;
}
