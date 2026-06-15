import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { EventHandler, ApiMeta } from './lib/handler.js';

/**
 * Convention (Nuxt/Nitro style). Files live under `server/api` and are named
 * `<name>.<method>.ts`:
 *
 *   server/api/users/list.get.ts      ->  GET    /api/users/list
 *   server/api/users/create.post.ts   ->  POST   /api/users/create
 *   server/api/users/index.get.ts     ->  GET    /api/users
 *   server/api/users/[id].get.ts      ->  GET    /api/users/:id
 *   server/api/files/[...path].get.ts ->  GET    /api/files/*   (catch-all)
 *
 * Each file default-exports a handler made with `defineEventHandler`.
 */

const METHOD_RE = /\.(get|post|put|patch|delete|head|options)\.(ts|js|mjs)$/i;

type SegmentType = 'static' | 'param' | 'catchall';

interface Segment {
  type: SegmentType;
  value: string; // literal for static; param name for param/catchall
}

export interface Route {
  method: string;
  segments: Segment[];
  handler: EventHandler;
  pattern: string; // human-readable, for startup logging
  meta?: ApiMeta;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (METHOD_RE.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

function parseFile(apiDir: string, file: string): { method: string; segments: Segment[]; pattern: string } {
  let rel = file.slice(apiDir.length).replace(/\\/g, '/');
  if (rel.startsWith('/')) rel = rel.slice(1);
  rel = rel.replace(/\.(ts|js|mjs)$/i, '');

  const lastSlash = rel.lastIndexOf('/');
  const dir = lastSlash === -1 ? '' : rel.slice(0, lastSlash);
  const name = lastSlash === -1 ? rel : rel.slice(lastSlash + 1);

  const dotIdx = name.lastIndexOf('.');
  const method = name.slice(dotIdx + 1).toUpperCase();
  let base = name.slice(0, dotIdx);
  if (base === 'index') base = '';

  const segStrings = [dir, base].filter(Boolean).join('/').split('/').filter(Boolean);

  const segments: Segment[] = segStrings.map((s) => {
    if (s.startsWith('[...') && s.endsWith(']')) {
      return { type: 'catchall', value: s.slice(4, -1) };
    }
    if (s.startsWith('[') && s.endsWith(']')) {
      return { type: 'param', value: s.slice(1, -1) };
    }
    return { type: 'static', value: s };
  });

  const pattern =
    '/api/' +
    segments
      .map((s) => (s.type === 'static' ? s.value : s.type === 'param' ? `:${s.value}` : `*${s.value}`))
      .join('/');

  return { method, segments, pattern };
}

/** Higher score = matched first (static beats param beats catch-all). */
function score(route: Route): number {
  let total = 0;
  for (const seg of route.segments) {
    if (seg.type === 'static') total += 3;
    else if (seg.type === 'param') total += 1;
  }
  return total;
}

/** Scan the api directory and import every route handler once, at startup. */
export async function loadRoutes(apiDir: string): Promise<Route[]> {
  let files: string[];
  try {
    files = await walk(apiDir);
  } catch {
    return [];
  }

  const routes: Route[] = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(file).href);
    const handler = mod.default;
    if (typeof handler !== 'function') {
      console.warn(`[router] ${file} has no default-exported handler, skipping`);
      continue;
    }
    const { method, segments, pattern } = parseFile(apiDir, file);
    const meta = mod.meta as ApiMeta | undefined;
    routes.push({ method, segments, handler, pattern, meta });
  }

  routes.sort((a, b) => score(b) - score(a));
  return routes;
}

function tryMatch(segments: Segment[], parts: string[]): Record<string, string> | null {
  const params: Record<string, string> = {};
  let i = 0;
  for (; i < segments.length; i++) {
    const seg = segments[i]!;
    if (seg.type === 'catchall') {
      params[seg.value] = parts.slice(i).map(decodeURIComponent).join('/');
      return params;
    }
    const part = parts[i];
    if (part === undefined) return null;
    if (seg.type === 'static') {
      if (seg.value !== part) return null;
    } else {
      params[seg.value] = decodeURIComponent(part);
    }
  }
  return i === parts.length ? params : null;
}

export function matchRoute(
  routes: Route[],
  method: string,
  pathname: string,
): { route: Route; params: Record<string, string> } | null {
  let p = pathname;
  if (p.startsWith('/api')) p = p.slice(4);
  const parts = p.split('/').filter(Boolean);

  for (const route of routes) {
    if (route.method !== method) continue;
    const params = tryMatch(route.segments, parts);
    if (params) return { route, params };
  }
  return null;
}
