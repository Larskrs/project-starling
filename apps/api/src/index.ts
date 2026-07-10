import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { loadRoutes, matchRoute, type Route } from './router.js';
import { ApiError, type ApiEvent, sendJson, appendVary, acceptsGzip } from './lib/handler.js';
import { setupSockets } from './lib/sockets.js';
import { applyCors, applySecurityHeaders } from './lib/security.js';

const here         = dirname(fileURLToPath(import.meta.url));
const apiDir       = join(here, 'routes');
const webDist      = join(here, '../../web/dist');
const homepageDist = join(here, '../../homepage/dist');
const PORT         = Number(process.env.PORT ?? 3000);

const MIME: Record<string, string> = {
  '.html':  'text/html; charset=utf-8',
  '.js':    'application/javascript; charset=utf-8',
  '.mjs':   'application/javascript; charset=utf-8',
  '.css':   'text/css; charset=utf-8',
  '.svg':   'image/svg+xml',
  '.png':   'image/png',
  '.ico':   'image/x-icon',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.json':  'application/json',
};

interface RouteTreeNode {
  children: Map<string, RouteTreeNode>;
  methods: string[];
}

function printRouteTree(routes: Route[]): void {
  const root: RouteTreeNode = { children: new Map(), methods: [] };

  for (const route of routes) {
    const parts = route.pattern.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    let node = root;
    for (const part of parts) {
      if (!node.children.has(part)) {
        node.children.set(part, { children: new Map(), methods: [] });
      }
      node = node.children.get(part)!;
    }
    node.methods.push(route.method);
  }

  function print(node: RouteTreeNode, prefix: string): void {
    const entries = [...node.children.entries()];
    entries.forEach(([seg, child], i) => {
      const last = i === entries.length - 1;
      const methods = child.methods.length > 0 ? `  \x1b[2m${child.methods.join(' ')}\x1b[0m` : '';
      console.log(`${prefix}${last ? '└─' : '├─'} ${seg}${methods}`);
      print(child, prefix + (last ? '   ' : '│  '));
    });
  }

  console.log(`\x1b[2m[server] ${routes.length} routes:\x1b[0m`);
  console.log('/api');
  print(root, '');
}

const routes = await loadRoutes(apiDir);
printRouteTree(routes);

// ── Static file cache ─────────────────────────────────────────────────────────
// Web-app assets are read from disk once, pre-gzipped when compressible, and
// revalidated by mtime — so a page load costs memory lookups, not disk reads.

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.svg', '.json']);

interface StaticEntry { mtimeMs: number; body: Buffer; gzip: Buffer | null; etag: string }
const staticCache = new Map<string, StaticEntry>();

/** Serves a file with caching, ETag/304, and gzip. Returns false when missing. */
async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
  filePath: string,
  contentType: string,
  cacheControl: string,
): Promise<boolean> {
  // Containment guard — the URL parser already normalises dot segments, this
  // makes traversal structurally impossible even if that ever changes.
  if (!resolve(filePath).startsWith(resolve(root))) return false;

  let st;
  try { st = await stat(filePath); } catch { return false; }

  let entry = staticCache.get(filePath);
  if (!entry || entry.mtimeMs !== st.mtimeMs) {
    const body = await readFile(filePath);
    const ext  = extname(filePath);
    entry = {
      mtimeMs: st.mtimeMs,
      body,
      gzip:    COMPRESSIBLE.has(ext) && body.length > 1024 ? gzipSync(body) : null,
      etag:    `"${st.size}-${Math.round(st.mtimeMs)}"`,
    };
    staticCache.set(filePath, entry);
  }

  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('ETag', entry.etag);

  if (req.headers['if-none-match'] === entry.etag) {
    res.statusCode = 304;
    res.end();
    return true;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);

  if (entry.gzip && acceptsGzip(req)) {
    appendVary(res, 'Accept-Encoding');
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', entry.gzip.length);
    res.end(entry.gzip);
  } else {
    res.setHeader('Content-Length', entry.body.length);
    res.end(entry.body);
  }
  return true;
}

/**
 * Serves a Vite SPA build from `root`: paths with an extension are assets
 * (404 when missing), everything else falls back to `index.html`.
 */
async function serveSpa(
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
  rel: string,
  appName: string,
): Promise<void> {
  const ext     = extname(rel);
  const isAsset = ext.length > 0;

  const filePath     = isAsset ? join(root, rel) : join(root, 'index.html');
  const contentType  = MIME[isAsset ? ext : '.html'] ?? 'application/octet-stream';
  const cacheControl = rel.startsWith('/assets/')
    ? 'public, max-age=31536000, immutable'   // content-hashed filenames
    : 'no-cache';                             // revalidates via ETag → 304

  const served = await serveStatic(req, res, root, filePath, contentType, cacheControl);
  if (!served) {
    if (isAsset) {
      sendJson(res, 404, { error: 'Not found' });
    } else {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.statusCode = 503;
      res.end(`${appName} app not built — run: npm run build -w ${appName}`);
    }
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  applySecurityHeaders(res);

  // Disallowed cross-site origins are refused outright — never reflected into
  // Access-Control-Allow-Origin alongside credentials, and never executed.
  if (!applyCors(req, res)) {
    sendJson(res, 403, { error: 'Origin not allowed' });
    return;
  }

  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }

  if (url.pathname === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
    await serveSpa(req, res, webDist, url.pathname.slice('/app'.length) || '/', 'web');
    return;
  }

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    const match = matchRoute(routes, req.method ?? 'GET', url.pathname);
    if (!match) { sendJson(res, 404, { error: 'Not found', path: url.pathname }); return; }

    const event: ApiEvent = { req, res, method: req.method ?? 'GET', url, params: match.params };
    try {
      const result = await match.route.handler(event);
      if (res.writableEnded) return;
      if (result === undefined || result === null) { res.statusCode = 204; res.end(); return; }
      sendJson(res, res.statusCode && res.statusCode !== 200 ? res.statusCode : 200, result);
    } catch (err) {
      if (err instanceof ApiError) {
        sendJson(res, err.statusCode, {
          error:    err.message,
          ...(err.errorKey ? { errorKey: err.errorKey } : {}),
          ...(err.data     ? { data:     err.data     } : {}),
        });
        return;
      }
      console.error('[server] unhandled error:', err);
      sendJson(res, 500, { error: 'Internal Server Error', errorKey: 'errors.generic.systemError' });
    }
    return;
  }

  // Anything else falls through to the public homepage. Socket.IO owns
  // `/socket` (root + `/timeline` namespaces) and intercepts those requests
  // before this handler runs.
  if (req.method === 'GET' || req.method === 'HEAD') {
    await serveSpa(req, res, homepageDist, url.pathname, 'homepage');
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

setupSockets(server);

server.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
