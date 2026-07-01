import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRoutes, matchRoute, type Route } from './router.js';
import { ApiError, type ApiEvent, sendJson } from './lib/handler.js';
import { setupSockets } from './lib/sockets.js';

const here    = dirname(fileURLToPath(import.meta.url));
const apiDir  = join(here, 'routes');
const webDist = join(here, '../../web/dist');
const PORT    = Number(process.env.PORT ?? 3000);

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

const server = createServer(async (req, res) => {
  const url    = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const origin = req.headers.origin;

  res.setHeader('Access-Control-Allow-Origin',      origin ?? '*');
  res.setHeader('Access-Control-Allow-Methods',     'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',     'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }

  if (url.pathname === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
    const rel     = url.pathname.slice('/app'.length) || '/';
    const ext     = extname(rel);
    const isAsset = ext.length > 0;

    try {
      const body        = await readFile(isAsset ? join(webDist, rel) : join(webDist, 'index.html'));
      const contentType = MIME[isAsset ? ext : '.html'] ?? 'application/octet-stream';
      res.setHeader('Content-Type',  contentType);
      res.setHeader('Cache-Control', rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      res.statusCode = 200;
      res.end(body);
    } catch {
      if (isAsset) {
        sendJson(res, 404, { error: 'Not found' });
      } else {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.statusCode = 503;
        res.end('Web app not built — run: npm run build -w web');
      }
    }
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

  sendJson(res, 404, { error: 'Not found' });
});

setupSockets(server);

server.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
