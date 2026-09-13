import z from 'zod';
import { defineEventHandler, getAuth, getValidatedQuery, createError, appendVary } from '../../lib/handler.js';
import { docPage, docGroups } from '../../lib/docsStore.js';

const querySchema = z.object({
  // Slashes are meaningful — 'integrations/writing' is one page, not two path
  // segments. Passing it as a query parameter keeps the file router out of
  // catch-all territory for a single endpoint.
  slug: z.string().min(1).max(200),
});

/**
 * One page, as HTML, with the visibility check.
 *
 * Rendered when the file last changed, not per visitor — a docs page is the
 * same bytes every time, so parsing it on each request is work repeated for
 * nothing, and doing it here keeps the markdown parser and the syntax
 * highlighter out of the browser entirely.
 *
 * The markdown is deliberately never bundled into the web app either: compiling
 * these files into the client would publish every private page to anyone who
 * loads it, whatever the router does.
 */
export default defineEventHandler(async (event) => {
  const { slug } = getValidatedQuery(event, querySchema);
  const session = await getAuth(event);

  appendVary(event.res, 'Cookie');

  const result = await docPage(slug, !!session);

  if (result.status === 'not-found') {
    throw createError({ statusCode: 404, message: 'No such page', errorKey: 'errors.docs.notFound' });
  }
  if (result.status === 'forbidden') {
    throw createError({
      statusCode: 401,
      message:    'This page is internal',
      errorKey:   'errors.docs.signInRequired',
    });
  }

  return {
    page: result.page,
    html: result.html,
    headings: result.headings,
    // Sent with the page so navigating between docs is one request, not two.
    groups: await docGroups(!!session),
  };
});
