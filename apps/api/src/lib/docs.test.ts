/**
 * Regression guard for documentation discovery, visibility and search.
 *
 *     node apps/api/src/lib/docs.test.ts
 *
 * (Standalone, same convention as the web tests — the repo has no test runner.
 * Exits non-zero on failure.)
 *
 * This module is deliberately dependency-free — node builtins only — which is
 * what lets it be tested without a database, a server or a bundler.
 */

// Both loaded through a non-literal specifier, like the TimelineEditor tests:
// node strips types from the .ts path, and tsc leaves a dynamic import it
// cannot resolve statically alone.
const mod = await import(process.argv[2] ?? './docs.ts');
const store = await import(process.argv[3] ?? './docsStore.ts');
const { splitSections, searchIndex, listDocs } = mod as {
  splitSections: (page: unknown, md: string) => { heading: string | null; headingId: string | null; text: string }[];
  searchIndex: (entries: unknown[], q: string, limit?: number) => {
    slug: string; title: string; heading: string | null; headingId: string | null; snippet: string;
  }[];
  listDocs: () => Promise<{ slug: string; isPublic: boolean; dir: string }[]>;
};

// The visibility checks below run against the STORE, because that is what
// answers a request. Testing the discovery layer would prove the wrong thing:
// the projection is where a leak would actually happen.
const { docSearch, docGroups, docPage } = store as {
  docSearch: (q: string, includePrivate: boolean) => Promise<{ slug: string }[]>;
  docGroups: (includePrivate: boolean) => Promise<{ category: string; pages: { slug: string; title: string }[] }[]>;
  docPage: (slug: string, includePrivate: boolean) => Promise<{ status: string }>;
};

let failed = 0;
async function check(name: string, fn: () => unknown | Promise<unknown>): Promise<void> {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${(err as Error).message}`); }
}
function eq(actual: unknown, expected: unknown, what = ''): void {
  if (actual !== expected) throw new Error(`${what} expected ${String(expected)}, got ${String(actual)}`);
}
function assert(cond: unknown, msg: string): void { if (!cond) throw new Error(msg); }

const page = {
  slug: 'integrations/authentication', title: 'Authentication',
  category: 'Integrations', dir: 'integrations', file: '', isPublic: true, order: 1,
};

const MD = `
Intro paragraph about tokens.

## Permissions are a role

A token reuses the production role system. Tokens are capped.

## Sending the token over REST

Use an Authorization bearer header.
`;

console.log('\nsplitSections');

await check('a page splits at its H2s', () => {
  const parts = splitSections(page, MD);
  eq(parts.length, 3, 'sections:');
  eq(parts[0]!.heading, null, 'opening section:');
  eq(parts[1]!.heading, 'Permissions are a role', 'second heading:');
});

await check('section ids match the anchors the web renderer generates', () => {
  const parts = splitSections(page, MD);
  eq(parts[1]!.headingId, 'permissions-are-a-role');
  eq(parts[2]!.headingId, 'sending-the-token-over-rest');
});

console.log('\nsearchIndex');

const entries = [
  ...splitSections(page, MD),
  ...splitSections(
    { ...page, slug: 'realtime', title: 'Live updates', category: 'Reference', dir: '' },
    '## Rooms\n\nPresence is per user. A token is mentioned once here.',
  ),
];

await check('a one-character query returns nothing', () => {
  eq(searchIndex(entries, 'a').length, 0);
  eq(searchIndex(entries, '  ').length, 0);
});

await check('a title match outranks a passing body mention', () => {
  const hits = searchIndex(entries, 'authentication');
  assert(hits.length > 0, 'no hits');
  eq(hits[0]!.title, 'Authentication', 'top hit:');
});

await check('a heading match beats an unrelated page', () => {
  const hits = searchIndex(entries, 'permissions');
  assert(hits.length > 0, 'no hits');
  eq(hits[0]!.heading, 'Permissions are a role', 'top heading:');
});

await check('results carry an anchor so they deep-link to the section', () => {
  const hits = searchIndex(entries, 'bearer');
  assert(hits.length > 0, 'no hits');
  eq(hits[0]!.headingId, 'sending-the-token-over-rest');
});

await check('a snippet reads as prose, not as markdown syntax', () => {
  const hits = searchIndex(entries, 'bearer');
  assert(!hits[0]!.snippet.includes('##'), `markdown in snippet: ${hits[0]!.snippet}`);
  assert(hits[0]!.snippet.toLowerCase().includes('bearer'), 'snippet lost the match');
});

await check('the section about a term beats one that mentions it once', () => {
  const hits = searchIndex(entries, 'token');
  assert(hits.length >= 2, 'expected several hits');
  assert(hits[0]!.slug.startsWith('integrations'), `top hit was ${hits[0]!.slug}`);
});

await check('snake_case identifiers stay searchable', () => {
  // A blanket /[*_]/ emphasis strip eats these underscores, which silently
  // broke the single most likely search an integrator types. `cino_svc`
  // indexed as `cinosvc` and matched nothing.
  const e = splitSections(page, 'The mask drops MANAGE_MEMBERS and MANAGE_ROLES from every token.');
  assert(searchIndex(e, 'MANAGE_MEMBERS').length > 0, 'snake_case term not found');
  assert(searchIndex(e, 'manage_roles').length > 0, 'lowercase snake_case term not found');
});

await check('emphasis is still unwrapped in snippets', () => {
  const e = splitSections(page, 'A **bold** and an _italic_ word about revocation.');
  const snippet = searchIndex(e, 'revocation')[0]!.snippet;
  assert(!snippet.includes('**'), `bold markers survived: ${snippet}`);
  assert(snippet.includes('bold') && snippet.includes('italic'), `emphasised text was eaten: ${snippet}`);
});

await check('nothing matching returns nothing', () => {
  eq(searchIndex(entries, 'zzzznotaword').length, 0);
});

console.log('\nvisibility, against the real docs folder');

/** The folders published to signed-out readers. */
const PUBLIC_CATEGORIES = ['Integrations', 'Examples'];
const isPublicSlug = (slug: string) => slug.startsWith('integrations') || slug.startsWith('examples');

await check('the integration guide is public and the reference is not', async () => {
  const pages = await listDocs();
  for (const dir of ['integrations', 'examples']) {
    const published = pages.filter(p => p.dir === dir);
    assert(published.length > 0, `no ${dir} pages found`);
    assert(published.every(p => p.isPublic), `a page in ${dir} is not public`);
  }
  assert(pages.some(p => !p.dir && !p.isPublic), 'no private reference page found');
});

await check('a signed-out listing hides private pages', async () => {
  const groups = await docGroups(false);
  assert(groups.every(g => PUBLIC_CATEGORIES.includes(g.category)),
    `private categories leaked: ${groups.map(g => g.category).join(', ')}`);
});

await check('a signed-out SEARCH never reaches a private page', async () => {
  // The listing and the search are separate paths, and a leak here would be
  // quieter: content, not just a title.
  const hits = await docSearch('presence', false);
  assert(hits.every(h => isPublicSlug(h.slug)),
    `private content leaked: ${hits.map(h => h.slug).join(', ')}`);
});

await check('a signed-in search does reach them', async () => {
  const hits = await docSearch('presence', true);
  assert(hits.some(h => !isPublicSlug(h.slug)), 'found no internal pages');
});

await check('searching the real guide finds the token format', async () => {
  assert((await docSearch('cino_svc', false)).length > 0, 'no hits for the token format');
});

await check('a slug never reaches the filesystem', async () => {
  // Slugs are matched against the built page list, never joined onto a path, so
  // a traversal attempt simply matches nothing.
  for (const slug of ['../../.env', 'integrations/../../.env', '%2e%2e%2fapi', 'nope']) {
    eq((await docPage(slug, true)).status, 'not-found', `slug ${slug}:`);
  }
});

await check('a private page is forbidden, not hidden, when signed out', async () => {
  eq((await docPage('realtime', false)).status, 'forbidden', 'signed out:');
  eq((await docPage('realtime', true)).status, 'ok', 'signed in:');
});

console.log('\nthe public projection');

await check('nothing about the filesystem crosses the wire', async () => {
  // The listing once returned the whole internal record — absolute path on
  // disk included — to anyone who asked.
  const groups = await docGroups(true);
  const serialised = JSON.stringify(groups);
  for (const leak of ['file', 'mtimeMs', 'isPublic', 'dir', '.md', 'docs\\\\', 'docs/']) {
    assert(!serialised.includes(leak), `"${leak}" leaked in ${serialised.slice(0, 160)}`);
  }
});

await check('a page response carries a name and a category, nothing more', async () => {
  const result = await docPage('integrations', true) as { status: string; page: Record<string, unknown> };
  eq(result.status, 'ok');
  eq(Object.keys(result.page).sort().join(','), 'category,slug,title', 'page fields:');
});

console.log(failed ? `\n${failed} failed\n` : '\nall passed\n');
if (failed) process.exit(1);

export {};
