import z from 'zod';
import { defineEventHandler, getAuth, getValidatedQuery, appendVary } from '../../lib/handler.js';
import { docSearch } from '../../lib/docsStore.js';

const querySchema = z.object({
  q: z.string().min(1).max(120),
});

/**
 * Full-text search across the pages this caller may read.
 *
 * Server-side, for the same reason the markdown is: searching in the browser
 * would mean shipping every page to it, including the private ones. A signed-out
 * reader searches the public set and cannot tell the rest exists.
 *
 * The index is prebuilt with the pages, so a query is pure in-memory work —
 * no file reads, no markdown parsing. It is rebuilt automatically whenever a
 * source file is newer than the bundle, so it cannot go stale.
 */
export default defineEventHandler(async (event) => {
  const { q } = getValidatedQuery(event, querySchema);
  const session = await getAuth(event);

  appendVary(event.res, 'Cookie');

  return { hits: await docSearch(q, !!session) };
});
