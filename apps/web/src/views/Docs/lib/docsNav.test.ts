/**
 * Regression guard for documentation navigation.
 *
 *     node apps/web/src/views/Docs/lib/docsNav.test.ts
 *
 * (Standalone, same convention as the TimelineEditor tests — the repo has no
 * test runner. Exits non-zero on failure.)
 */

const mod = await import(process.argv[2] ?? './docsNav.ts');
const { neighbours, breadcrumb, filterGroups, flattenGroups, highlightParts } = mod as {
  neighbours: (g: unknown[], slug: string) => { prev: { slug: string } | null; next: { slug: string } | null };
  breadcrumb: (g: unknown[], slug: string) => { label: string; to: string | null }[];
  filterGroups: (g: unknown[], q: string) => { category: string; pages: { slug: string }[] }[];
  flattenGroups: (g: unknown[]) => { slug: string }[];
  highlightParts: (text: string, q: string) => { text: string; match: boolean }[];
};

let failed = 0;
function check(name: string, fn: () => void): void {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${(err as Error).message}`); }
}
function eq(actual: unknown, expected: unknown, what = ''): void {
  if (actual !== expected) throw new Error(`${what} expected ${String(expected)}, got ${String(actual)}`);
}
function deepEq(actual: unknown, expected: unknown, what = ''): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what} expected ${e}, got ${a}`);
}
function assert(cond: unknown, msg: string): void { if (!cond) throw new Error(msg); }

const GROUPS = [
  { category: 'Reference', pages: [
    { slug: 'api', title: 'API Reference' },
    { slug: 'realtime', title: 'Live updates' },
  ] },
  { category: 'Integrations', pages: [
    { slug: 'integrations', title: 'Overview' },
    { slug: 'integrations/authentication', title: 'Authentication' },
    { slug: 'integrations/limits', title: 'Limits and logging' },
  ] },
];

console.log('\nneighbours');

check('the first page has no previous', () => {
  const n = neighbours(GROUPS, 'api');
  eq(n.prev, null, 'prev:');
  eq(n.next!.slug, 'realtime', 'next:');
});

check('the last page has no next', () => {
  const n = neighbours(GROUPS, 'integrations/limits');
  eq(n.next, null, 'next:');
  eq(n.prev!.slug, 'integrations/authentication', 'prev:');
});

check('navigation crosses category boundaries', () => {
  // The sidebar order IS the reading order. Stopping at the end of a group
  // would strand the reader with nowhere obvious to go.
  const n = neighbours(GROUPS, 'realtime');
  eq(n.next!.slug, 'integrations', 'next across the boundary:');
});

check('an unknown slug has neither neighbour', () => {
  const n = neighbours(GROUPS, 'nope');
  eq(n.prev, null); eq(n.next, null);
});

console.log('\nbreadcrumb');

check('a nested page names its category', () => {
  deepEq(breadcrumb(GROUPS, 'integrations/authentication'), [
    { label: 'Documentation', to: '/docs' },
    { label: 'Integrations', to: '/docs/integrations' },
    { label: 'Authentication', to: null },
  ]);
});

check('a folder index does not repeat itself as its own category', () => {
  // 'integrations' IS the Integrations category, so "Integrations / Overview"
  // would say the same thing twice.
  deepEq(breadcrumb(GROUPS, 'integrations'), [
    { label: 'Documentation', to: '/docs' },
    { label: 'Overview', to: null },
  ]);
});

check('a category with no index page is a label, not a dead link', () => {
  const groups = [{ category: 'Guides', pages: [{ slug: 'guides/one', title: 'One' }] }];
  const crumbs = breadcrumb(groups, 'guides/one');
  eq(crumbs[1]!.label, 'Guides', 'label:');
  eq(crumbs[1]!.to, null, 'link:');
});

console.log('\nfilterGroups');

check('filtering drops groups that empty out', () => {
  const out = filterGroups(GROUPS, 'auth');
  eq(out.length, 1, 'groups:');
  eq(out[0]!.category, 'Integrations', 'category:');
  eq(out[0]!.pages.length, 1, 'pages:');
});

check('an empty filter returns everything unchanged', () => {
  eq(filterGroups(GROUPS, '   ').length, 2);
  eq(flattenGroups(GROUPS).length, 5, 'flattened:');
});

console.log('\nhighlightParts');

check('a match is split out from its surroundings', () => {
  deepEq(highlightParts('the token expires', 'token'), [
    { text: 'the ', match: false },
    { text: 'token', match: true },
    { text: ' expires', match: false },
  ]);
});

check('matching is case-insensitive but preserves the original text', () => {
  const parts = highlightParts('Token and token', 'TOKEN');
  eq(parts.filter(p => p.match).length, 2, 'matches:');
  eq(parts[0]!.text, 'Token', 'original casing:');
});

check('no match returns the text whole', () => {
  deepEq(highlightParts('nothing here', 'zzz'), [{ text: 'nothing here', match: false }]);
});

check('markup in the source text is never treated as markup', () => {
  // Snippets come from documents. These are parts for interpolation, so a
  // document containing angle brackets stays text.
  const parts = highlightParts('<script>alert(1)</script>', 'alert');
  const joined = parts.map(p => p.text).join('');
  eq(joined, '<script>alert(1)</script>', 'round trip:');
  assert(parts.some(p => p.match), 'the query was not found');
});

console.log(failed ? `\n${failed} failed\n` : '\nall passed\n');
if (failed) process.exit(1);

export {};
