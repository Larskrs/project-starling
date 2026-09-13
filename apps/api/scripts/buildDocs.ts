import { buildBundle, writeBundle, bundlePath } from '../src/lib/docsStore.js';

/**
 * Renders every page in `docs/` to a single JSON bundle.
 *
 *     npm run docs:build -w api
 *
 * Run as part of the API build, so a deployed server parses no markdown and
 * walks no directory to answer a docs request. The server still checks the
 * bundle against the source files' mtimes on load, so forgetting to run this
 * degrades to rendering on demand rather than serving something stale.
 */

const bundle = await buildBundle();

if (bundle.pages.length === 0) {
  console.error('[docs] no pages found — is docs/ where it should be?');
  process.exit(1);
}

const path = await writeBundle(bundle);
const written = await bundlePath();

const publicCount = bundle.pages.filter(p => p.isPublic).length;
const sections    = bundle.pages.reduce((n, p) => n + p.sections.length, 0);
const kb = written ? Math.round(written.bytes / 1024) : 0;

console.log(`[docs] ${bundle.pages.length} pages (${publicCount} public), ${sections} search sections → ${path} (${kb} KB)`);

for (const page of [...bundle.pages].sort((a, b) => a.slug.localeCompare(b.slug))) {
  console.log(`       ${page.isPublic ? 'public ' : 'private'}  /docs/${page.slug}`);
}
