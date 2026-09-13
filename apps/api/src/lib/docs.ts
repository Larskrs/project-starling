import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, relative, extname, basename, dirname, sep } from 'node:path';

/**
 * Discovery and visibility for the `docs/` folder.
 *
 * The URL structure IS the file structure — there is no route table to keep in
 * step with the folder. Drop `docs/deploy/plesk.md` in and `/docs/deploy/plesk`
 * exists; delete it and the page is gone. The only transformation is
 * lowercasing, so `API.md` answers to `/docs/api`.
 *
 * This module used to render HTML and serve a whole site of its own. The pages
 * now live in the web app, next to the timeline editor, so they share its shell,
 * theme and navigation instead of being a second site with a second design.
 *
 * This module only DISCOVERS and describes. Rendering, caching, search and the
 * public projections live in docsStore, which builds on top of it.
 *
 * A DocPage carries an absolute path on disk and the flag that decides who may
 * read it. Neither belongs in a response, so nothing here is ever returned to a
 * caller directly — the store projects it first.
 */

const DOCS_ROOT = resolve(join(import.meta.dirname, '../../../../docs'));

/** Sidebar group for pages that sit directly in `docs/`. */
export const ROOT_CATEGORY = 'Reference';

export interface DocPage {
  /** URL path below /docs, e.g. 'api' or 'integrations/writing'. */
  slug: string;
  /** Absolute path on disk. */
  file: string;
  /** Display title — front matter `title`, else the first H1, else the filename. */
  title: string;
  /**
   * Readable without signing in.
   *
   * Opt-in per page via `public: true` front matter, so a new file is private
   * by default and publishing one is a deliberate act rather than something
   * that happens because a folder was named a particular way.
   */
  isPublic: boolean;
  /** Sidebar group — front matter `category`, else the containing folder. */
  category: string;
  /** Sort key inside a category; ties fall back to slug. */
  order: number;
  /** Folder relative to `docs/`, '' at the root. Drives relative links. */
  dir: string;
  /** Last modified, so a prebuilt bundle can tell whether it is still current. */
  mtimeMs: number;
}

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
    .toLowerCase()
    // A folder's index page IS the folder: docs/integrations/index.md answers
    // at /docs/integrations, so a category has a landing page instead of a URL
    // ending in the word "index".
    .replace(/\/index$/, '');
}

/** The folder a file sits in, relative to `docs/` — '' at the root. */
function dirOf(file: string): string {
  const rel = relative(DOCS_ROOT, dirname(file));
  return rel === '' || rel === '.' ? '' : rel.split(sep).join('/').toLowerCase();
}

/** 'integrations' → 'Integrations', 'live-updates' → 'Live updates'. */
function titleCase(segment: string): string {
  const spaced = segment.replace(/[-_]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Minimal `key: value` front matter.
 *
 * Deliberately not a YAML parser. The only consumers are a handful of scalar
 * fields, and pulling in something that can evaluate arbitrary structures is a
 * poor trade for that — particularly for the field that decides whether a page
 * is readable without signing in. Anything unrecognised is ignored rather than
 * fatal, so a malformed header costs a default and never the page.
 */
function parseFrontMatter(source: string): { meta: Record<string, string>; body: string } {
  const m = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { meta: {}, body: source };

  const meta: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return { meta, body: source.slice(m[0].length) };
}

/** Reads a page's front matter and body, or null when it cannot be read. */
async function readPage(file: string): Promise<{ meta: Record<string, string>; body: string } | null> {
  try { return parseFrontMatter(await readFile(file, 'utf8')); }
  catch { return null; }
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

  const pages = await Promise.all(files.map(async (file): Promise<DocPage> => {
    const parsed  = await readPage(file);
    const meta    = parsed?.meta ?? {};
    const heading = parsed?.body.match(/^#\s+(.+)$/m)?.[1]?.trim();
    const dir     = dirOf(file);
    const order   = Number(meta.order);
    const mtimeMs = (await stat(file).catch(() => null))?.mtimeMs ?? 0;

    return {
      slug:     slugFor(file),
      file,
      dir,
      mtimeMs,
      title:    meta.title ?? heading ?? basename(file, extname(file)),
      // Anything other than an explicit `public: true` is private. A typo in
      // the value fails closed, which is the direction a visibility flag
      // should fail in.
      isPublic: meta.public?.toLowerCase() === 'true',
      category: meta.category ?? (dir ? titleCase(dir.split('/')[0]!) : ROOT_CATEGORY),
      order:    Number.isFinite(order) ? order : 100,
    };
  }));

  pages.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  indexCache = { at: Date.now(), pages };
  return pages;
}

/** A page's markdown with its front matter stripped, or null when unreadable. */
export async function readDocMarkdown(page: DocPage): Promise<string | null> {
  const parsed = await readPage(page.file);
  return parsed?.body ?? null;
}

// ── Search ────────────────────────────────────────────────────────────────────

export interface SearchEntry {
  slug: string;
  title: string;
  category: string;
  /** The H2 this text sits under, or null for the page's opening. */
  heading: string | null;
  headingId: string | null;
  text: string;
}

export interface DocSearchHit {
  slug: string;
  title: string;
  category: string;
  heading: string | null;
  headingId: string | null;
  snippet: string;
  score: number;
}

/** Mirrors the id the web renderer gives a heading, so results can deep-link. */
function slugifyHeading(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
}

/**
 * Splits a page into one entry per H2 section.
 *
 * Sections rather than whole pages, because a hit deep in a long reference page
 * is useless if it can only say "this page somewhere" — the section gives the
 * result a subtitle and an anchor to jump to.
 */
export function splitSections(page: DocPage, markdown: string): SearchEntry[] {
  const entries: SearchEntry[] = [];
  let heading: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) {
      entries.push({
        slug: page.slug, title: page.title, category: page.category,
        heading,
        headingId: heading ? slugifyHeading(heading) : null,
        text,
      });
    }
    buffer = [];
  };

  for (const line of markdown.split(/\r?\n/)) {
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) { flush(); heading = h2[1]!.trim(); continue; }
    buffer.push(line);
  }
  flush();
  return entries;
}

/**
 * Roughly de-markdowns text so a snippet reads as prose, not as syntax.
 *
 * Emphasis is unwrapped by matching the PAIR, never by deleting the characters.
 * A blanket `[*_]` strip also eats the underscores inside identifiers, which
 * silently made every snake_case term unsearchable — `cino_svc` indexed as
 * `cinosvc`, so the one string an integrator is most likely to paste into the
 * search box matched nothing.
 */
function plainText(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[>#\-*|]+\s*/gm, ' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    // Underscore emphasis only when it wraps a word, so identifiers survive.
    .replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

const SNIPPET_RADIUS = 90;

function snippetAround(text: string, at: number, length: number): string {
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end   = Math.min(text.length, at + length + SNIPPET_RADIUS);
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
}

/**
 * Ranks sections against a query.
 *
 * Pure, so the ranking can be tested without touching the filesystem. The
 * weights encode one judgement: a page whose TITLE matches is almost always
 * what you meant, and a passing mention in body text almost never is.
 */
export function searchIndex(entries: SearchEntry[], query: string, limit = 12): DocSearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const hits: DocSearchHit[] = [];

  for (const entry of entries) {
    const title   = entry.title.toLowerCase();
    const heading = (entry.heading ?? '').toLowerCase();
    const plain   = plainText(entry.text);
    const body    = plain.toLowerCase();

    let score = 0;
    if (title === q)               score += 120;
    else if (title.startsWith(q))  score += 80;
    else if (title.includes(q))    score += 50;

    if (heading.includes(q))       score += 30;

    const bodyAt = body.indexOf(q);
    if (bodyAt !== -1) {
      score += 12;
      // A term that recurs is more likely the section's subject than one that
      // appears once in passing. Capped so a glossary cannot dominate.
      let count = 0, from = 0, next: number;
      while ((next = body.indexOf(q, from)) !== -1 && count < 5) { count++; from = next + q.length; }
      score += Math.min(count, 5) * 2;
    }

    if (score === 0) continue;

    hits.push({
      slug: entry.slug,
      title: entry.title,
      category: entry.category,
      heading: entry.heading,
      headingId: entry.headingId,
      snippet: bodyAt !== -1 ? snippetAround(plain, bodyAt, q.length) : plain.slice(0, 160),
      score,
    });
  }

  // One result per section already; sort by score, then stable by slug so the
  // list does not reshuffle between identical-scoring keystrokes.
  hits.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return hits.slice(0, limit);
}
