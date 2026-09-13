import { defineEventHandler, getAuth, appendVary } from '../../lib/handler.js';
import { docGroups } from '../../lib/docsStore.js';

/**
 * The documentation index, filtered to what this caller may read.
 *
 * Open to anonymous callers on purpose: the integration guide is written for
 * third parties building equipment, and they have no account at the moment they
 * need it. Private pages are simply absent from the listing.
 *
 * Returns pages and categories and nothing else. It once returned the whole
 * internal record for each page, absolute path on disk included, to anyone who
 * asked — the projection in docsStore exists so that cannot happen again.
 *
 * Authenticated with the session cookie only. A bearer token is ignored rather
 * than honoured: a device has no business reading internal architecture pages,
 * and treating it as anonymous gives it the public set without a special case.
 */
export default defineEventHandler(async (event) => {
  const session = await getAuth(event);

  // The response differs by whether a session is present, so a shared cache
  // must not hand one visitor's listing to another.
  appendVary(event.res, 'Cookie');

  return { groups: await docGroups(!!session), signedIn: !!session };
});
