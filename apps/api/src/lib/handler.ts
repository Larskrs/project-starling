import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ZodType } from 'zod';
import type { SessionData } from './session.js';
import { sessionFromCookies } from './session.js';

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

/** Returns the session for the request cookie, or null. */
export async function getAuth(event: ApiEvent): Promise<AuthContext | null> {
  return sessionFromCookies(event.req.headers.cookie);
}

/** Returns the session or throws 401. */
export async function requireAuth(event: ApiEvent): Promise<AuthContext> {
  const auth = await getAuth(event);
  if (!auth) throw new ApiError(401, 'Authentication required', undefined, 'errors.generic.authRequired');
  return auth;
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

export async function readBody<T = unknown>(event: ApiEvent): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of event.req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
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

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
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
export async function readMultipart(event: ApiEvent): Promise<MultipartResult> {
  const ct = event.req.headers['content-type'] ?? '';
  const boundary = extractBoundary(ct);
  if (!boundary) throw new ApiError(400, 'Missing multipart boundary', undefined, 'errors.generic.invalidBody');

  const chunks: Buffer[] = [];
  for await (const chunk of event.req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);

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
