import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRoutes, matchRoute } from './router.js';
import { ApiError, type ApiEvent, sendJson } from './lib/handler.js';
import { setupSockets } from './lib/sockets.js';

const here   = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, 'routes');
const PORT   = Number(process.env.PORT ?? 3000);

const routes = await loadRoutes(apiDir);
console.log(`[server] loaded ${routes.length} route(s):`);
for (const r of routes) console.log(`  ${r.method.padEnd(6)} ${r.pattern}`);

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
        sendJson(res, err.statusCode, { error: err.message, ...(err.data ? { data: err.data } : {}) });
        return;
      }
      console.error('[server] unhandled error:', err);
      sendJson(res, 500, { error: 'Internal Server Error' });
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

setupSockets(server);

server.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
