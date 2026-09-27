import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Origin policy shared by the HTTP server and Socket.IO.
 *
 * Allowed: requests without an Origin header (same-origin navigations, curl,
 * server-to-server), any origin on the same site as the request's own host —
 * exact host match or subdomain in either direction (app.cino.no ↔ cino.no,
 * the standard "app on a subdomain, API on the apex" reverse-proxy layout) —
 * localhost during development, and anything listed in the CORS_ORIGINS env
 * var (comma-separated full origins, e.g. "https://app.example.com").
 *
 * Everything else is rejected — we never reflect arbitrary origins while also
 * sending Access-Control-Allow-Credentials, and disallowed browser requests
 * are refused outright (403) so credentialed side effects can't be triggered
 * cross-site even where SameSite wouldn't save us.
 */
const extraOrigins = new Set(
  (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
);

/** Lowercased hostname without port. */
function hostnameOf(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const host = hostHeader.split(',')[0]!.trim();      // first hop if forwarded list
  const idx  = host.lastIndexOf(':');
  return (idx > host.lastIndexOf(']') ? host.slice(0, idx) : host).toLowerCase() || null;
}

/** The host the client actually addressed — honours the reverse proxy (Plesk/nginx). */
export function requestHost(req: IncomingMessage): string | undefined {
  const fwd = req.headers['x-forwarded-host'];
  return (Array.isArray(fwd) ? fwd[0] : fwd) ?? req.headers.host;
}

export function isOriginAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  let url: URL;
  try { url = new URL(origin); } catch { return false; }

  const originHost = url.hostname.toLowerCase();
  const ownHost    = hostnameOf(host);

  if (ownHost) {
    if (originHost === ownHost) return true;
    if (originHost.endsWith('.' + ownHost)) return true;  // app.cino.no → cino.no/api
    if (ownHost.endsWith('.' + originHost)) return true;  // cino.no page → api.cino.no
  }
  if (originHost === 'localhost' || originHost === '127.0.0.1') return true;
  return extraOrigins.has(origin);
}

/**
 * Applies CORS response headers for an allowed origin, or returns false when
 * the origin must be rejected (caller responds 403 and stops).
 */
export function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (!origin) return true;
  if (!isOriginAllowed(origin, requestHost(req))) return false;

  res.setHeader('Access-Control-Allow-Origin',      origin);
  res.setHeader('Access-Control-Allow-Methods',     'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',     'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  return true;
}

/** Baseline hardening headers applied to every response. */
export function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
}

/** Best-effort client IP (first X-Forwarded-For hop, else the socket peer). */
export function getClientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0];
  return first?.trim() || req.socket.remoteAddress || 'unknown';
}
