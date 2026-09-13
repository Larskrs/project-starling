/**
 * Navigation derived from the page list.
 *
 * Pure and in .ts so it is typechecked and testable — `apps/web/tsconfig.json`
 * includes only `src/**​/*.ts`, so anything living in a .vue file is neither.
 */

export interface NavPage {
  slug: string;
  title: string;
}

export interface NavGroup {
  category: string;
  pages: NavPage[];
}

export interface Neighbours {
  prev: (NavPage & { category: string }) | null;
  next: (NavPage & { category: string }) | null;
}

/** Every page in sidebar order, which is the order you read them in. */
export function flattenGroups(groups: NavGroup[]): (NavPage & { category: string })[] {
  return groups.flatMap(g => g.pages.map(p => ({ ...p, category: g.category })));
}

/**
 * The pages either side of the current one.
 *
 * Deliberately crosses category boundaries: the sidebar order IS the reading
 * order, and stopping at the end of a group would strand the reader at the
 * bottom of a page with nowhere obvious to go.
 */
export function neighbours(groups: NavGroup[], slug: string): Neighbours {
  const flat = flattenGroups(groups);
  const i = flat.findIndex(p => p.slug === slug);
  if (i === -1) return { prev: null, next: null };
  return {
    prev: i > 0 ? flat[i - 1]! : null,
    next: i < flat.length - 1 ? flat[i + 1]! : null,
  };
}

export interface Crumb {
  label: string;
  to: string | null;
}

/**
 * Breadcrumb for a page: Documentation › Category › Page.
 *
 * The category links to its folder index only when one actually exists, since a
 * category is a folder name rather than a guaranteed page — a crumb that 404s
 * is worse than a crumb that is only a label.
 */
export function breadcrumb(groups: NavGroup[], slug: string): Crumb[] {
  const flat = flattenGroups(groups);
  const page = flat.find(p => p.slug === slug);
  if (!page) return [{ label: 'Documentation', to: '/docs' }];

  const crumbs: Crumb[] = [{ label: 'Documentation', to: '/docs' }];

  // A folder index page IS the category, so it would otherwise appear twice.
  const folder = flat.find(p => p.category === page.category && !p.slug.includes('/'));
  const categoryIsThisPage = folder?.slug === page.slug;

  if (!categoryIsThisPage) {
    crumbs.push({ label: page.category, to: folder ? `/docs/${folder.slug}` : null });
  }
  crumbs.push({ label: page.title, to: null });
  return crumbs;
}

/** Filters the sidebar, dropping groups that end up empty. */
export function filterGroups(groups: NavGroup[], query: string): NavGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map(g => ({ ...g, pages: g.pages.filter(p => p.title.toLowerCase().includes(q)) }))
    .filter(g => g.pages.length > 0);
}

/**
 * Splits text around each case-insensitive occurrence of `query`.
 *
 * Returned as parts rather than HTML on purpose: search snippets come from
 * documents, and building a highlighted string would mean interpolating that
 * text into markup. The template renders these with normal interpolation, so
 * there is nothing to escape and nothing to get wrong.
 */
export function highlightParts(text: string, query: string): { text: string; match: boolean }[] {
  const q = query.trim();
  if (!q) return [{ text, match: false }];

  const parts: { text: string; match: boolean }[] = [];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();

  let from = 0;
  for (;;) {
    const at = lower.indexOf(needle, from);
    if (at === -1) break;
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts.length ? parts : [{ text, match: false }];
}
