import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import {
  listDocs, readDocMarkdown, splitSections, searchIndex,
  ROOT_CATEGORY, type DocPage, type SearchEntry, type DocSearchHit,
} from './docs.js';
import { renderMarkdown, type Heading } from './docsRender.js';

/**
 * The documentation, rendered once and served many times.
 *
 * ── Prebuilt, with a live fallback ────────────────────────────────────────
 * `npm run docs:build` renders every page to `docs-dist/docs.json`, and the
 * API build runs it. In production that file is the whole story: no markdown is
 * parsed at runtime, no filesystem is walked per request, and search runs
 * against an index that was built once.
 *
 * The bundle records each source file's mtime. If any file on disk is newer, or
 * the bundle is missing entirely, the store builds in memory instead — so
 * editing a page in dev and refreshing still shows it, and a stale artifact can
 * never be served as if it were current. That was the one real objection to
 * prebuilding, and checking nine mtimes is cheaper than answering it with
 * discipline.
 *
 * ── What leaves this module ───────────────────────────────────────────────
 * Public projections only. A `DocPage` carries an absolute path on disk and the
 * flag that decides who may read it; neither has any business in a response, and
 * the listing used to ship both to anonymous callers. Everything crossing the
 * wire goes through `toPublicGroups` / `toPublicPage`, which cannot express a
 * file path.
 */

const BUNDLE_PATH = resolve(join(import.meta.dirname, '../../docs-dist/docs.json'));

/** Bumped when the shape changes, so an old artifact is ignored rather than misread. */
const BUNDLE_VERSION = 1;

export interface BuiltPage {
  slug: string;
  title: string;
  category: string;
  order: number;
  isPublic: boolean;
  /** Only used to resolve relative links while rendering; never sent anywhere. */
  dir: string;
  mtimeMs: number;
  html: string;
  headings: Heading[];
  sections: SearchEntry[];
}

export interface DocBundle {
  version: number;
  builtAt: string;
  pages: BuiltPage[];
}

// ── Building ──────────────────────────────────────────────────────────────────

async function buildPage(page: DocPage): Promise<BuiltPage | null> {
  const markdown = await readDocMarkdown(page);
  if (markdown === null) return null;

  const { html, headings } = renderMarkdown(markdown, page.dir);

  return {
    slug: page.slug, title: page.title, category: page.category,
    order: page.order, isPublic: page.isPublic, dir: page.dir, mtimeMs: page.mtimeMs,
    html, headings,
    sections: splitSections(page, markdown),
  };
}

/** Renders everything on disk. Used by the build script and by the dev fallback. */
export async function buildBundle(): Promise<DocBundle> {
  const pages = (await Promise.all((await listDocs()).map(buildPage)))
    .filter((p): p is BuiltPage => p !== null);

  return { version: BUNDLE_VERSION, builtAt: new Date().toISOString(), pages };
}

export async function writeBundle(bundle: DocBundle): Promise<string> {
  await mkdir(dirname(BUNDLE_PATH), { recursive: true });
  await writeFile(BUNDLE_PATH, JSON.stringify(bundle), 'utf8');
  return BUNDLE_PATH;
}

// ── Loading ───────────────────────────────────────────────────────────────────

let cached: DocBundle | null = null;
let cachedAt = 0;

/** How often the freshness check is allowed to re-stat the docs folder. */
const FRESHNESS_TTL_MS = 2000;

async function readPrebuilt(): Promise<DocBundle | null> {
  try {
    const raw = JSON.parse(await readFile(BUNDLE_PATH, 'utf8')) as DocBundle;
    return raw.version === BUNDLE_VERSION ? raw : null;
  } catch {
    return null;
  }
}

/**
 * A bundle that matches what is on disk right now.
 *
 * The prebuilt artifact wins whenever it is current. "Current" means it knows
 * about every page and none of them has been modified since it was written —
 * comparing mtimes rather than trusting the build, because the failure this
 * guards against is precisely someone forgetting to run it.
 */
export async function getBundle(): Promise<DocBundle> {
  if (cached && Date.now() - cachedAt < FRESHNESS_TTL_MS) return cached;

  const onDisk = await listDocs();
  const fresh = (bundle: DocBundle): boolean => {
    if (bundle.pages.length !== onDisk.length) return false;
    const built = new Map(bundle.pages.map(p => [p.slug, p.mtimeMs]));
    return onDisk.every(p => built.get(p.slug) === p.mtimeMs);
  };

  if (!cached || !fresh(cached)) {
    const prebuilt = await readPrebuilt();
    cached = prebuilt && fresh(prebuilt) ? prebuilt : await buildBundle();
  }

  cachedAt = Date.now();
  return cached;
}

// ── Public projections ────────────────────────────────────────────────────────

/** A page as the world is allowed to see it: a name and where it lives. */
export interface PublicDocPage { slug: string; title: string }
export interface PublicDocGroup { category: string; pages: PublicDocPage[] }

/** Root-level reference first, then named categories alphabetically. */
function toPublicGroups(pages: BuiltPage[]): PublicDocGroup[] {
  const byCategory = new Map<string, PublicDocPage[]>();

  for (const page of [...pages].sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug))) {
    const list = byCategory.get(page.category) ?? [];
    list.push({ slug: page.slug, title: page.title });
    byCategory.set(page.category, list);
  }

  return [...byCategory.entries()]
    .map(([category, list]) => ({ category, pages: list }))
    .sort((a, b) =>
      (a.category === ROOT_CATEGORY ? -1 : b.category === ROOT_CATEGORY ? 1 : 0)
      || a.category.localeCompare(b.category));
}

const visible = (pages: BuiltPage[], includePrivate: boolean) =>
  pages.filter(p => includePrivate || p.isPublic);

/** The sidebar, filtered to what this caller may read. */
export async function docGroups(includePrivate: boolean): Promise<PublicDocGroup[]> {
  return toPublicGroups(visible((await getBundle()).pages, includePrivate));
}

export type PageResult =
  | { status: 'ok'; page: { slug: string; title: string; category: string }; html: string; headings: Heading[] }
  | { status: 'not-found' }
  | { status: 'forbidden' };

/**
 * One page.
 *
 * A private page asked for without a session is `forbidden`, not `not-found`:
 * the slug is not a secret, and telling a signed-out reader to sign in is more
 * useful than pretending the page does not exist.
 */
export async function docPage(slug: string, includePrivate: boolean): Promise<PageResult> {
  const clean = slug.replace(/^\/+|\/+$/g, '').toLowerCase();
  const page = (await getBundle()).pages.find(p => p.slug === clean);

  if (!page) return { status: 'not-found' };
  if (!page.isPublic && !includePrivate) return { status: 'forbidden' };

  return {
    status: 'ok',
    page: { slug: page.slug, title: page.title, category: page.category },
    html: page.html,
    headings: page.headings,
  };
}

/** Full-text search over the pages this caller may read. */
export async function docSearch(query: string, includePrivate: boolean): Promise<DocSearchHit[]> {
  const pages = visible((await getBundle()).pages, includePrivate);
  return searchIndex(pages.flatMap(p => p.sections), query);
}

/** Exposed for the build script's summary line. */
export async function bundlePath(): Promise<{ path: string; bytes: number } | null> {
  const st = await stat(BUNDLE_PATH).catch(() => null);
  return st ? { path: BUNDLE_PATH, bytes: st.size } : null;
}
