import type { IncomingMessage, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import type { ZodType } from 'zod';
import type { SessionData } from './session.js';
import { parseSessionCookie, getSession, renewSessionIfDue } from './session.js';
import {
  verifyApiToken, recordTokenEvent, TOKEN_EXPIRES_HEADER, type TokenPrincipal,
} from './apiTokens.js';
import { getClientIp } from './security.js';
import { SOCKET_ID_HEADER } from '@starling/realtime';

// ── Route metadata ────────────────────────────────────────────────────────────

export interface ApiMeta {
  summary?:     string;
  description?: string;
  tags?:        string[];
  query?:       ZodType;
  body?:        ZodType;
  response?:    ZodType;
  /** Include in the unauthenticated public OpenAPI spec. */
  public?:      boolean;
  /** Minimum auth level required — documented in the spec. */
  auth?:        'none' | 'user' | 'admin';
}

export function defineApiMeta(meta: ApiMeta): ApiMeta { return meta; }

// ── Event ─────────────────────────────────────────────────────────────────────

export interface ApiEvent {
  req:    IncomingMessage;
  res:    ServerResponse;
  method: string;
  url:    URL;
  params: Record<string, string>;
  /**
   * Set by getPrincipal once the caller is resolved.
   *
   * Exists so the server can audit a token's mutations in ONE place after the
   * handler returns, instead of every mutating route remembering to log. That
   * is the same reasoning that moved live relays out of the client: a rule
   * enforced at one chokepoint cannot be forgotten by the next route someone
   * adds.
   */
  principal?: Principal;
}

export type EventHandler<T = unknown> = (event: ApiEvent) => T | Promise<T>;

export function defineEventHandler<T>(handler: EventHandler<T>): EventHandler<T> {
  return handler;
}

export class ApiError extends Error {
  statusCode: number;
  data?: unknown;
  errorKey?: string;

  constructor(statusCode: number, message: string, data?: unknown, errorKey?: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.data = data;
    this.errorKey = errorKey;
  }
}

export function createError(opts: { statusCode: number; message: string; data?: unknown; errorKey?: string }): ApiError {
  return new ApiError(opts.statusCode, opts.message, opts.data, opts.errorKey);
}

// ── Auth helpers ──────────────────────────────────────────────────────────────

export type AuthContext = SessionData;

/** A signed-in person. */
export interface UserPrincipal extends SessionData {
  kind: 'user';
}

/**
 * Who is making a request: a person holding a session, or a machine holding an
 * API token.
 *
 * `resolveAccessLevel` never cared what kind of thing an id belonged to, which
 * is what lets a second kind of caller exist without a parallel permission
 * system. The two differ in exactly two places: which memberships they resolve
 * through, and which routes they may reach at all.
 */
export type Principal = UserPrincipal | TokenPrincipal;

/** Returns the session for the request cookie, or null. */
export async function getAuth(event: ApiEvent): Promise<AuthContext | null> {
  const id = parseSessionCookie(event.req.headers.cookie);
  if (!id) return null;
  const session = await getSession(id);
  if (!session) return null;

  // Sliding renewal: refresh the cookie once the session is past half its TTL
  // so active users never hit the fixed 24h cliff mid-work. Routes that set
  // their own session cookie (login/logout) overwrite this header afterwards.
  if (!event.res.headersSent && !event.res.getHeader('Set-Cookie')) {
    const refreshed = await renewSessionIfDue(id, session).catch(() => null);
    if (refreshed) event.res.setHeader('Set-Cookie', refreshed);
  }

  return session;
}

function bearerToken(event: ApiEvent): string | null {
  const raw = event.req.headers.authorization;
  if (typeof raw !== 'string') return null;
  const m = /^Bearer\s+(\S+)$/i.exec(raw.trim());
  return m ? m[1]! : null;
}

/**
 * Resolves the caller, token first.
 *
 * A bearer token BEATS a session cookie when both are present, so a
 * misconfigured proxy that forwards someone's cookie alongside a device's
 * token cannot silently upgrade the device to that person's access.
 */
export async function getPrincipal(event: ApiEvent): Promise<Principal | null> {
  const raw = bearerToken(event);

  if (raw) {
    const result = await verifyApiToken(raw);
    if (!result.ok) {
      recordTokenEvent({
        event:  'rejected',
        ip:     getClientIp(event.req),
        detail: `${result.reason} on ${event.method} ${event.url.pathname}`,
      });
      throw new ApiError(401, 'Invalid or expired token', undefined, `errors.auth.${result.reason}`);
    }

    // Lets a device alarm locally before it is locked out, rather than
    // discovering the problem as a 401 in the middle of a show.
    if (!event.res.headersSent) {
      event.res.setHeader(TOKEN_EXPIRES_HEADER, result.principal.expiresAt.toISOString());
    }
    event.principal = result.principal;
    return result.principal;
  }

  const session = await getAuth(event);
  if (!session) return null;

  const principal: Principal = { kind: 'user', ...session };
  event.principal = principal;
  return principal;
}

/**
 * Returns the signed-in user, or throws 401.
 *
 * Tokens are refused here by design. Access for a machine is an ALLOWLIST: a
 * route opts in by resolving a principal itself, and everything else stays
 * closed. That matters because several routes filter by the caller's own user
 * id rather than by a production — `/api/production/list` and `/api/user/me`
 * among them — so a token admitted here would report on the account of whoever
 * issued it.
 */
export async function requireAuth(event: ApiEvent): Promise<AuthContext> {
  const principal = await getPrincipal(event);
  if (!principal) throw new ApiError(401, 'Authentication required', undefined, 'errors.generic.authRequired');
  if (principal.kind === 'token') {
    throw new ApiError(401, 'This endpoint is not available to API tokens', undefined, 'errors.auth.tokenNotPermitted');
  }
  return principal;
}

/** Returns the session (admin only) or throws 401/403. */
export async function requireAdmin(event: ApiEvent): Promise<AuthContext> {
  const auth = await requireAuth(event);
  if (auth.role !== 'admin') throw new ApiError(403, 'Admin access required', undefined, 'errors.generic.adminRequired');
  return auth;
}

// ── Request helpers ───────────────────────────────────────────────────────────

export function getQuery(event: ApiEvent): Record<string, string> {
  return Object.fromEntries(event.url.searchParams.entries());
}

export function getRouterParam(event: ApiEvent, name: string): string | undefined {
  return event.params[name];
}

const MAX_JSON_BODY_BYTES      = 1 * 1024 * 1024;   // JSON endpoints
const MAX_MULTIPART_BODY_BYTES = 64 * 1024 * 1024;  // default for multipart; override per route

/**
 * Buffers the request body up to `maxBytes`; beyond that the request is
 * aborted with 413 instead of buffering unbounded client input into memory.
 */
export async function readRawBody(event: ApiEvent, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of event.req) {
    total += (chunk as Buffer).length;
    if (total > maxBytes) {
      // Stop reading and close the connection after the 413 is written —
      // destroying the request here would kill the socket before the client
      // ever sees the response.
      event.res.setHeader('Connection', 'close');
      event.req.pause();
      throw new ApiError(413, 'Payload too large', { maxBytes }, 'errors.generic.payloadTooLarge');
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function readBody<T = unknown>(event: ApiEvent): Promise<T> {
  const raw = (await readRawBody(event, MAX_JSON_BODY_BYTES)).toString('utf8').trim();
  if (!raw) return undefined as T;
  try { return JSON.parse(raw) as T; }
  catch { throw new ApiError(400, 'Invalid JSON body', undefined, 'errors.generic.invalidBody'); }
}

export async function readValidatedBody<T>(event: ApiEvent, schema: ZodType<T>): Promise<T> {
  const body   = await readBody(event);
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiError(422, JSON.stringify(result.error.flatten().fieldErrors), result.error.flatten(), 'errors.generic.validationFailed');
  return result.data;
}

/** Drops keys whose value is `undefined` — e.g. building a PATCH update from an all-optional body. */
export function pickDefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

export function getValidatedQuery<T>(event: ApiEvent, schema: ZodType<T>): T {
  const result = schema.safeParse(getQuery(event));
  if (!result.success) throw new ApiError(422, 'Invalid query parameters', result.error.flatten(), 'errors.generic.validationFailed');
  return result.data;
}

/** Adds a value to the Vary header without clobbering what's already there. */
export function appendVary(res: ServerResponse, value: string): void {
  const prev = res.getHeader('Vary');
  if (!prev) { res.setHeader('Vary', value); return }
  if (String(prev).toLowerCase().includes(value.toLowerCase())) return;
  res.setHeader('Vary', `${prev}, ${value}`);
}

export function acceptsGzip(req: IncomingMessage | undefined): boolean {
  return /\bgzip\b/.test(String(req?.headers['accept-encoding'] ?? ''));
}

// Compress sizeable JSON payloads (timeline bootstraps, file listings) — below
// this gzip overhead outweighs the savings.
const COMPRESS_MIN_BYTES = 2048;

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const payload = Buffer.from(JSON.stringify(body));
  if (payload.length >= COMPRESS_MIN_BYTES && acceptsGzip(res.req)) {
    const compressed = gzipSync(payload);
    appendVary(res, 'Accept-Encoding');
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', compressed.length);
    res.end(compressed);
    return;
  }

  res.setHeader('Content-Length', payload.length);
  res.end(payload);
}

// ── Multipart helpers ─────────────────────────────────────────────────────────

export interface MultipartFile {
  filename: string;
  mimeType: string;
  data:     Buffer;
}

export interface MultipartResult {
  fields: Record<string, string>;
  files:  Record<string, MultipartFile>;
}

function extractBoundary(contentType: string): string | null {
  const m = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

function parsePartHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\r\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    out[line.slice(0, idx).toLowerCase().trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

/** Parse a multipart/form-data request body without external dependencies. */
export async function readMultipart(
  event: ApiEvent,
  { maxBytes = MAX_MULTIPART_BODY_BYTES }: { maxBytes?: number } = {},
): Promise<MultipartResult> {
  const ct = event.req.headers['content-type'] ?? '';
  const boundary = extractBoundary(ct);
  if (!boundary) throw new ApiError(400, 'Missing multipart boundary', undefined, 'errors.generic.invalidBody');

  const body = await readRawBody(event, maxBytes);

  const fields: Record<string, string> = {};
  const files:  Record<string, MultipartFile> = {};

  const delim  = Buffer.from(`\r\n--${boundary}`);
  const opener = Buffer.from(`--${boundary}\r\n`);

  let pos = body.indexOf(opener);
  if (pos === -1) throw new ApiError(400, 'Invalid multipart body', undefined, 'errors.generic.invalidBody');
  pos += opener.length;

  while (pos < body.length) {
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), pos);
    if (headerEnd === -1) break;

    const headers   = parsePartHeaders(body.subarray(pos, headerEnd).toString('utf8'));
    const dataStart = headerEnd + 4;
    const nextDelim = body.indexOf(delim, dataStart);
    const dataEnd   = nextDelim === -1 ? body.length : nextDelim;
    const data      = body.subarray(dataStart, dataEnd);

    const disposition  = headers['content-disposition'] ?? '';
    const nameMatch    = disposition.match(/name="([^"]+)"/);
    const filenameMatch = disposition.match(/filename="([^"]+)"/);
    const name = nameMatch?.[1];

    if (name) {
      if (filenameMatch) {
        files[name] = {
          filename: filenameMatch[1]!,
          mimeType: headers['content-type'] ?? 'application/octet-stream',
          data,
        };
      } else {
        fields[name] = data.toString('utf8');
      }
    }

    if (nextDelim === -1) break;
    pos = nextDelim + delim.length;
    // \r\n → more parts,  -- → closing delimiter (end)
    if (body[pos] === 0x2d && body[pos + 1] === 0x2d) break;
    if (body[pos] === 0x0d && body[pos + 1] === 0x0a) pos += 2;
    else break;
  }

  return { fields, files };
}

/**
 * The caller's socket id, from the SOCKET_ID_HEADER a live client sends on
 * mutating requests.
 *
 * Used to keep a server-side relay from echoing a change back to whoever made
 * it. Absent for curl, native clients and anyone not holding a socket — in
 * which case the relay simply goes to everyone, which is idempotent.
 */
export function getSocketId(event: ApiEvent): string | null {
  const raw = event.req.headers[SOCKET_ID_HEADER];
  const id = Array.isArray(raw) ? raw[0] : raw;
  return typeof id === 'string' && id.length > 0 && id.length <= 64 ? id : null;
}
