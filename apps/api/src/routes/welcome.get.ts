import { sql } from 'drizzle-orm';
import { clips, companies, db, productions, storageFiles, timelines, tracks, users } from '@starling/db';
import { ApiError, defineEventHandler } from '../lib/handler.js';
import { TtlCache } from '../lib/cache.js';
import { createRateLimiter } from '../lib/rateLimit.js';
import { getClientIp } from '../lib/security.js';

/**
 * Server-wide totals for the signed-out welcome page.
 *
 * Deliberately the only unauthenticated read in the API: every value is a bare
 * COUNT/SUM over a whole table, so nothing here names a company, a project or a
 * person — there is no per-caller access to check because no row is exposed.
 */
export interface WelcomeStats {
  companies:   number;
  productions: number;
  timelines:   number;
  tracks:      number;
  clips:       number;
  users:       number;
  files:       number;
  /** Total bytes of stored media, hidden files excluded. */
  mediaBytes:  number;
  /** When the cached snapshot was computed — see CACHE_TTL_MS. */
  generatedAt: string;
}

// The numbers move in hours, not seconds, and eight full-table counts per
// visitor is a silly price for a marketing page — so one snapshot is shared by
// every caller for a minute, and the same TTL goes out as a Cache-Control.
const CACHE_TTL_MS = 60_000;
const CACHE_KEY    = 'stats';
const cache        = new TtlCache<string, WelcomeStats>(CACHE_TTL_MS, 1);

// A cache miss is the only thing that reaches the DB, so the limit only has to
// keep a burst of cold callers from stacking up counts.
const limiter = createRateLimiter({ windowMs: 60_000, max: 60 });

async function computeStats(): Promise<WelcomeStats> {
  const total = sql<number>`count(*)`;

  const [
    companyRows, productionRows, timelineRows, trackRows,
    clipRows, userRows, fileRows,
  ] = await Promise.all([
    db.select({ n: total }).from(companies),
    db.select({ n: total }).from(productions),
    db.select({ n: total }).from(timelines),
    db.select({ n: total }).from(tracks),
    db.select({ n: total }).from(clips),
    db.select({ n: total }).from(users),
    db.select({
      n:     total,
      bytes: sql<number>`coalesce(sum(${storageFiles.size}), 0)`,
    }).from(storageFiles).where(sql`${storageFiles.hidden} = false`),
  ]);

  // count()/sum() come back as bigints, which postgres-js hands over as strings.
  return {
    companies:   Number(companyRows[0]?.n ?? 0),
    productions: Number(productionRows[0]?.n ?? 0),
    timelines:   Number(timelineRows[0]?.n ?? 0),
    tracks:      Number(trackRows[0]?.n ?? 0),
    clips:       Number(clipRows[0]?.n ?? 0),
    users:       Number(userRows[0]?.n ?? 0),
    files:       Number(fileRows[0]?.n ?? 0),
    mediaBytes:  Number(fileRows[0]?.bytes ?? 0),
    generatedAt: new Date().toISOString(),
  };
}

export default defineEventHandler(async (event): Promise<WelcomeStats> => {
  const cached = cache.get(CACHE_KEY);
  if (cached) {
    event.res.setHeader('Cache-Control', `public, max-age=${CACHE_TTL_MS / 1000}`);
    return cached;
  }

  if (!limiter.check(getClientIp(event.req))) {
    throw new ApiError(429, 'Too many requests — try again shortly', undefined, 'errors.generic.rateLimited');
  }

  const stats = await computeStats();
  cache.set(CACHE_KEY, stats);

  event.res.setHeader('Cache-Control', `public, max-age=${CACHE_TTL_MS / 1000}`);
  return stats;
});
