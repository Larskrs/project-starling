/**
 * Regression guard for documentation rendering.
 *
 *     node apps/api/src/lib/docsRender.test.ts
 *
 * (Standalone, same convention as the web tests — the repo has no test runner.
 * Exits non-zero on failure.)
 *
 * Link rewriting is the part worth pinning down. A docs page's links are
 * relative to its FILE, and a folder index page's slug is the folder itself —
 * so resolving against the slug instead of the directory sends every sibling
 * link one level too high, which is invisible until someone clicks one.
 */

const mod = await import(process.argv[2] ?? './docsRender.ts');
const { renderMarkdown, rewriteLink, headingId } = mod as {
  renderMarkdown: (src: string, dir: string) => { html: string; headings: { id: string; text: string }[] };
  rewriteLink: (href: string, dir: string) => string;
  headingId: (text: string) => string;
};

let failed = 0;
function check(name: string, fn: () => void): void {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${(err as Error).message}`); }
}
function eq(actual: unknown, expected: unknown, what = ''): void {
  if (actual !== expected) throw new Error(`${what} expected ${String(expected)}, got ${String(actual)}`);
}
function assert(cond: unknown, msg: string): void { if (!cond) throw new Error(msg); }

console.log('\nrewriteLink');

check('a sibling link stays inside its folder', () => {
  eq(rewriteLink('./authentication.md', 'integrations'), '/docs/integrations/authentication');
});

check('a parent link climbs exactly one level', () => {
  eq(rewriteLink('../realtime.md', 'integrations'), '/docs/realtime');
});

check('a root-level page links to another root page', () => {
  eq(rewriteLink('./api.md', ''), '/docs/api');
});

check('a link to a folder index collapses to the folder', () => {
  eq(rewriteLink('./index.md', 'integrations'), '/docs/integrations');
  eq(rewriteLink('./integrations/index.md', ''), '/docs/integrations');
});

check('anchors survive the rewrite', () => {
  eq(rewriteLink('./limits.md#rate', 'integrations'), '/docs/integrations/limits#rate');
});

check('a source-file link goes to the repository', () => {
  assert(
    rewriteLink('../apps/api/src/lib/liveRoom.ts', '').endsWith('/apps/api/src/lib/liveRoom.ts'),
    'source link was not rewritten to the repo',
  );
});

check('absolute and external links are untouched', () => {
  eq(rewriteLink('https://example.com/x', 'integrations'), 'https://example.com/x');
  eq(rewriteLink('#section', 'integrations'), '#section');
  eq(rewriteLink('mailto:a@b.c', ''), 'mailto:a@b.c');
});

console.log('\nheadingId');

check('ids are slugs, not sentences', () => {
  eq(headingId('Expiry and revocation'), 'expiry-and-revocation');
  eq(headingId('What a token *cannot* reach'), 'what-a-token-cannot-reach');
});

console.log('\nrenderMarkdown');

check('only H2s reach the contents list', () => {
  const { headings } = renderMarkdown('# Title\n\n## One\n\n### Deep\n\n## Two\n', '');
  eq(headings.length, 2, 'heading count:');
  eq(headings[0]!.id, 'one');
  eq(headings[1]!.id, 'two');
});

check('internal links are marked for the router, external ones are not', () => {
  const { html } = renderMarkdown('[a](./authentication.md) and [b](https://example.com)', 'integrations');
  assert(html.includes('data-doclink'), 'internal link was not marked');
  assert(html.includes('target="_blank"'), 'external link does not open in a new tab');
  assert(html.includes('rel="noopener noreferrer"'), 'external link is missing noopener');
});

check('tables are wrapped so the wrapper scrolls, not the table', () => {
  const { html } = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |\n', '');
  assert(html.includes('<div class="tablewrap wide">'), 'table was not wrapped');
  assert(html.includes('<table>'), 'table stopped being a table');
});

check('code blocks are highlighted and get a copy button', () => {
  const { html } = renderMarkdown('```ts\nconst x: number = 1\n```', '');
  assert(html.includes('data-copy'), 'no copy button');
  assert(html.includes('hljs-'), 'nothing was highlighted');
});

check('an unknown language does not throw, and is escaped', () => {
  const { html } = renderMarkdown('```wat\n<script>alert(1)</script>\n```', '');
  assert(!html.includes('<script>alert(1)</script>'), 'raw html survived in a code block');
  assert(html.includes('&lt;script&gt;'), 'code was not escaped');
});

check('inline SVG diagrams pass through untouched', () => {
  // Diagrams are authored as SVG in the markdown, so they need no library at
  // all — at build time or in the browser. marked must leave them alone.
  const svg = '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
  const { html } = renderMarkdown(`<figure class="diagram">${svg}</figure>`, '');
  assert(html.includes('<svg'), 'the svg was stripped');
  assert(html.includes('viewBox'), 'svg attributes were mangled');
});

check('a diagram with blank lines and indentation survives whole', () => {
  // marked ends an HTML block at the first blank line and reads a four-space
  // indent as code. Real diagrams have both, and every one in the docs rendered
  // as debris — <text> wrapped in <p>, or a chunk of SVG shown as a code block —
  // while the one-line figure above passed.
  const figure = [
    '<figure class="diagram">',
    '<svg viewBox="0 0 10 10">',
    '  <g>',
    '    <rect width="10" height="10" />',
    '',
    '    <text x="1" y="5">label</text>',
    '  </g>',
    '</svg>',
    '</figure>',
  ].join('\n');
  const { html } = renderMarkdown(`Before.\n\n${figure}\n\nAfter.`, '');
  assert(html.includes(figure), 'the figure did not come through byte for byte');
  assert(!/<p>\s*<text|<pre>|&lt;rect/.test(html), 'marked parsed the inside of the figure');
  assert(html.includes('<p>Before.</p>') && html.includes('<p>After.</p>'), 'the prose around the figure stopped rendering');
});

console.log(failed ? `\n${failed} failed\n` : '\nall passed\n');
if (failed) process.exit(1);

export {};
