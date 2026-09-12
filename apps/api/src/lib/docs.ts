import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, relative, extname, basename, dirname, sep } from 'node:path';
import { Marked } from 'marked';
import hljs from 'highlight.js';
import { DOCS_CSS, DOCS_JS } from './docsTheme.js';

/**
 * Serves `docs/` as a browsable site under `/docs/`.
 *
 * The URL structure IS the file structure — there is no route table to keep in
 * step with the folder. Drop `docs/deploy/plesk.md` in and `/docs/deploy/plesk`
 * exists; delete it and the page is gone. The only transformation is
 * lowercasing, so `API.md` answers to `/docs/api`.
 *
 * Pages are rendered on demand and cached by mtime, the same way the static
 * asset cache works: editing a file and refreshing shows the change, without a
 * restart and without re-parsing markdown on every request.
 */

const DOCS_ROOT = resolve(join(import.meta.dirname, '../../../../docs'));

/** Where a source-file link should point, since a served page has no filesystem. */
const REPO_BLOB_URL = 'https://github.com/Larskrs/project-starling/blob/main';

export interface DocPage {
  /** URL path below /docs, e.g. 'api' or 'deploy/plesk'. */
  slug: string;
  /** Absolute path on disk. */
  file: string;
  /** Display title — the first H1, falling back to the filename. */
  title: string;
}

interface RenderedPage { mtimeMs: number; html: string }

const pageCache = new Map<string, RenderedPage>();

/** Tree discovery is cheap but not free; re-scan at most this often. */
const INDEX_TTL_MS = 2000;
let indexCache: { at: number; pages: DocPage[] } | null = null;

// ── Discovery ─────────────────────────────────────────────────────────────────

function slugFor(file: string): string {
  const rel = relative(DOCS_ROOT, file);
  return rel
    .split(sep)
    .join('/')
    .replace(/\.md$/i, '')
    .toLowerCase();
}

async function firstHeading(file: string): Promise<string | null> {
  try {
    const text = await readFile(file, 'utf8');
    const m = text.match(/^#\s+(.+)$/m);
    return m ? m[1]!.trim() : null;
  } catch {
    return null;
  }
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }

  for (const entry of entries) {
    // Dot-directories are housekeeping, not content.
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (extname(entry.name).toLowerCase() === '.md') out.push(full);
  }
}

/** Every page currently on disk, sorted by slug. */
export async function listDocs(): Promise<DocPage[]> {
  if (indexCache && Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache.pages;

  const files: string[] = [];
  await walk(DOCS_ROOT, files);

  const pages = await Promise.all(files.map(async (file) => ({
    slug:  slugFor(file),
    file,
    title: (await firstHeading(file)) ?? basename(file, extname(file)),
  })));

  pages.sort((a, b) => a.slug.localeCompare(b.slug));
  indexCache = { at: Date.now(), pages };
  return pages;
}

/**
 * The file a slug refers to, or null.
 *
 * Resolved by matching against the DISCOVERED list rather than by joining the
 * slug onto a path. A slug never reaches the filesystem, so `../../.env` has
 * nothing to traverse — it simply matches no page. The containment check below
 * is a second line of defence for the same reason the static handler keeps one.
 */
async function fileForSlug(slug: string): Promise<DocPage | null> {
  const clean = slug.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!clean) return null;

  const page = (await listDocs()).find(p => p.slug === clean);
  if (!page) return null;
  if (!resolve(page.file).startsWith(DOCS_ROOT)) return null;
  return page;
}


// ── Rendering ─────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/**
 * Rewrites the two kinds of relative link the docs contain.
 *
 * `./REALTIME.md` → `/docs/realtime`, so cross-references work as navigation
 * rather than as broken file paths.
 *
 * `../apps/api/src/lib/liveRoom.ts` → the file on GitHub. A served page has no
 * filesystem to point at, and these links are the docs' way of saying "the code
 * is here" — dropping them would lose the most useful thing about them.
 */
function rewriteLink(href: string, fromSlug: string): string {
  if (/^(https?:|mailto:|#)/i.test(href)) return href;

  const md = href.match(/^\.{1,2}\/(.+)\.md(#.*)?$/i);
  if (md) {
    const dir = dirname(fromSlug);
    const target = href.startsWith('../')
      ? md[1]!.toLowerCase()
      : (dir === '.' ? md[1]!.toLowerCase() : `${dir}/${md[1]!.toLowerCase()}`);
    return `/docs/${target}${md[2] ?? ''}`;
  }

  if (href.startsWith('../')) return `${REPO_BLOB_URL}/${href.replace(/^(\.\.\/)+/, '')}`;
  return href;
}

/** Stable id for a heading, so the sidebar and deep links can reach it. */
function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export interface Heading { id: string; text: string }

/** highlight.js names for the fence labels the docs actually use. */
const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript',
  sh: 'bash', shell: 'bash', console: 'bash',
  yml: 'yaml',
};

function renderMarkdown(source: string, slug: string): { html: string; headings: Heading[] } {
  const headings: Heading[] = [];
  const marked = new Marked({ gfm: true, breaks: false });

  marked.use({
    renderer: {
      link({ href, title, tokens }: { href: string; title?: string | null; tokens: unknown[] }) {
        const text = this.parser.parseInline(tokens as never);
        const to = rewriteLink(href, slug);
        // Anything leaving the site opens in a new tab, with noopener so the
        // opened page cannot reach back through window.opener.
        const external = /^https?:/i.test(to);
        const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `<a href="${escapeHtml(to)}"${title ? ` title="${escapeHtml(title)}"` : ''}${attrs}>${text}</a>`;
      },

      heading({ tokens, depth }: { tokens: unknown[]; depth: number }) {
        const text = this.parser.parseInline(tokens as never);
        if (depth === 1) return `<h1>${text}</h1>\n`;
        const id = headingId(text);
        // Only H2s reach the sidebar: H1 is the page title, H3+ is detail that
        // would bury the sections you actually navigate between.
        if (depth === 2) headings.push({ id, text });
        const anchor = `<a class="hanchor" href="#${id}" aria-label="Link to this section">#</a>`;
        return `<h${depth} id="${id}">${anchor}${text}</h${depth}>\n`;
      },

      /**
       * Code blocks get a toolbar: the language, and a copy button.
       *
       * Highlighting is done HERE, on the server, and cached with the page — so
       * it costs the reader nothing. A client-side highlighter would ship a
       * parser for every language and then re-run it on every page load.
       */
      code({ text, lang }: { text: string; lang?: string }) {
        const raw = (lang ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
        const language = LANG_ALIASES[raw] ?? raw;
        const known = language && hljs.getLanguage(language);

        let body: string;
        try {
          body = known
            ? hljs.highlight(text, { language, ignoreIllegals: true }).value
            : escapeHtml(text);
        } catch {
          // A grammar that chokes must not take the page down with it.
          body = escapeHtml(text);
        }

        const label = known ? language : (raw || 'text');
        return `<div class="codeblock wide">`
          + `<div class="codeblock__bar">`
          + `<span class="codeblock__lang">${escapeHtml(label)}</span>`
          + `<button class="codeblock__copy" type="button">Copy</button>`
          + `</div>`
          + `<pre><code class="hljs">${body}</code></pre>`
          + `</div>\n`;
      },

      /**
       * The WRAPPER scrolls, not the table.
       *
       * `display: block` on a <table> — the usual quick fix — throws away table
       * layout, so columns stop aligning and the header stops being sticky.
       * Wrapping keeps the table a table and gives the overflow somewhere to go.
       */
      table({ header, rows }: { header: unknown[]; rows: unknown[][] }) {
        const head = (header as never[]).map(cell =>
          `<th>${this.parser.parseInline((cell as { tokens: never[] }).tokens)}</th>`).join('');
        const body = (rows as never[][]).map(row =>
          `<tr>${row.map(cell =>
            `<td>${this.parser.parseInline((cell as { tokens: never[] }).tokens)}</td>`).join('')}</tr>`).join('');
        return `<div class="tablewrap wide"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>\n`;
      },
    },
  });

  return { html: marked.parse(source) as string, headings };
}

// ── Page shell ────────────────────────────────────────────────────────────────

function navHtml(pages: DocPage[], activeSlug: string, headings: Heading[]): string {
  const links = pages.map((p) => {
    const active = p.slug === activeSlug;
    const toc = active && headings.length
      ? `<div class="side__toc">${headings
          .map(h => `<a href="#${h.id}">${h.text}</a>`).join('')}</div>`
      : '';
    return `<a href="/docs/${p.slug}"${active ? ' aria-current="page"' : ''}>${escapeHtml(p.title)}</a>${toc}`;
  }).join('');

  return `<div class="side__group">Documentation</div>${links}`;
}

function shell(title: string, activeSlug: string, pages: DocPage[], headings: Heading[], body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)} — Cino docs</title>
<style>${DOCS_CSS}</style>
</head>
<body>
<div class="layout">
  <aside class="side">
    <div class="side__head">
      <span class="side__mark" aria-hidden="true"></span>
      <a class="side__title" href="/docs/" style="text-decoration:none">Cino docs</a>
      <button class="side__theme" type="button" aria-label="Toggle dark mode" title="Toggle dark mode">◐</button>
    </div>
    <div class="side__search">
      <input type="search" placeholder="Filter pages…" aria-label="Filter pages">
    </div>
    <nav class="side__nav">${navHtml(pages, activeSlug, headings)}</nav>
  </aside>
  <main><article class="prose">${body}</article></main>
</div>
<script>${DOCS_JS}</script>
</body>
</html>`;
}

// ── Public surface ────────────────────────────────────────────────────────────

/** The generated index at `/docs/`. */
export async function renderIndex(): Promise<string> {
  const pages = await listDocs();
  const cards = pages.map(p =>
    `<li><a class="card" href="/docs/${p.slug}">`
    + `<div class="card__title">${escapeHtml(p.title)}</div>`
    + `<div class="card__slug">/docs/${escapeHtml(p.slug)}</div>`
    + `</a></li>`
  ).join('');

  const body = `<h1>Documentation</h1>
<p class="lede">Every page here is a file in <code>docs/</code>. The URL mirrors the path,
so adding a markdown file publishes a page and deleting one takes it down.</p>
<ul class="cards wide">${cards || '<li>No pages found.</li>'}</ul>`;

  return shell('Documentation', '', pages, [], body);
}

/** A single page, or null when the slug matches nothing. */
export async function renderPage(slug: string): Promise<string | null> {
  const page = await fileForSlug(slug);
  if (!page) return null;

  const st = await stat(page.file).catch(() => null);
  if (!st) return null;

  const cached = pageCache.get(page.slug);
  if (cached && cached.mtimeMs === st.mtimeMs) return cached.html;

  const source = await readFile(page.file, 'utf8');
  const { html, headings } = renderMarkdown(source, page.slug);
  const pages = await listDocs();
  const full = shell(page.title, page.slug, pages, headings, html);

  pageCache.set(page.slug, { mtimeMs: st.mtimeMs, html: full });
  return full;
}
