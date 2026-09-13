import { Marked } from 'marked';
import hljs from 'highlight.js';

/**
 * Markdown → HTML. Pure: give it a source and a folder, get a page back.
 *
 * Runs at BUILD time, through `docsStore`, which renders every page once into a
 * bundle. Nothing here executes while serving a request in production, and none
 * of it reaches a browser — the parser, the highlighter and its grammars came to
 * around 340 KB gzipped, downloaded by every reader to produce bytes that are
 * identical every time.
 *
 * The store keeps a live fallback for development, so this is also what runs
 * when a source file is newer than the bundle. Caching and freshness live there;
 * this module only knows how to turn one document into one page.
 */

/** Where a source-file link should point, since a served page has no filesystem. */
const REPO_BLOB_URL = 'https://github.com/Larskrs/project-starling/blob/main';

export interface Heading { id: string; text: string }

export interface RenderedDoc {
  html: string;
  /** H2s only — what the in-page contents list is built from. */
  headings: Heading[];
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/**
 * Rewrites the two kinds of relative link the docs contain.
 *
 * `./authentication.md` → `/docs/integrations/authentication`, so a
 * cross-reference is navigation rather than a broken file path.
 *
 * `../apps/api/src/lib/liveRoom.ts` → the file on GitHub. A served page has no
 * filesystem to point at, and these links are how the docs say "the code is
 * here" — dropping them would lose the most useful thing about them.
 *
 * Resolved against the page's FOLDER, not its slug. A folder index page has the
 * folder itself as its slug, so deriving the directory from the slug would send
 * every sibling link one level too high.
 */
export function rewriteLink(href: string, fromDir: string): string {
  if (/^(https?:|mailto:|#)/i.test(href)) return href;

  const md = href.match(/^(\.{1,2})\/(.+)\.md(#.*)?$/i);
  if (md) {
    const segments = fromDir ? fromDir.split('/') : [];
    if (md[1] === '..') segments.pop();
    const target = [...segments, md[2]!.toLowerCase()].join('/').replace(/\/index$/, '');
    return `/docs/${target}${md[3] ?? ''}`;
  }

  if (href.startsWith('../')) return `${REPO_BLOB_URL}/${href.replace(/^(\.\.\/)+/, '')}`;
  return href;
}

/** Stable id for a heading, so the contents list and deep links can reach it. */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** highlight.js names for the fence labels the docs actually use. */
const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript',
  sh: 'bash', shell: 'bash', console: 'bash',
  yml: 'yaml', jsonc: 'json',
};

export function renderMarkdown(source: string, fromDir: string): RenderedDoc {
  const headings: Heading[] = [];
  const marked = new Marked({ gfm: true, breaks: false });

  marked.use({
    renderer: {
      link({ href, title, tokens }: { href: string; title?: string | null; tokens: unknown[] }) {
        const text = this.parser.parseInline(tokens as never);
        const to = rewriteLink(href, fromDir);
        // Anything leaving the app opens in a new tab, with noopener so the
        // opened page cannot reach back through window.opener.
        const external = /^https?:/i.test(to);
        const attrs = external
          ? ' target="_blank" rel="noopener noreferrer"'
          : ' data-doclink';   // intercepted by the view and routed, not reloaded
        return `<a href="${escapeHtml(to)}"${title ? ` title="${escapeHtml(title)}"` : ''}${attrs}>${text}</a>`;
      },

      heading({ tokens, depth }: { tokens: unknown[]; depth: number }) {
        const text = this.parser.parseInline(tokens as never);
        if (depth === 1) return `<h1>${text}</h1>\n`;
        const id = headingId(text);
        // Only H2s reach the contents list: H1 is the page title, and H3+ is
        // detail that would bury the sections you actually navigate between.
        if (depth === 2) headings.push({ id, text });
        const anchor = `<a class="hanchor" href="#${id}" aria-label="Link to this section">#</a>`;
        return `<h${depth} id="${id}">${anchor}${text}</h${depth}>\n`;
      },

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
          + `<button class="codeblock__copy" type="button" data-copy>Copy</button>`
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
