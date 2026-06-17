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

  constructor(statusCode: number, message: string, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.data = data;
  }
}

export function createError(opts: { statusCode: number; message: string; data?: unknown }): ApiError {
  return new ApiError(opts.statusCode, opts.message, opts.data);
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
  if (!auth) throw new ApiError(401, 'Authentication required');
  return auth;
}

/** Returns the session (admin only) or throws 401/403. */
export async function requireAdmin(event: ApiEvent): Promise<AuthContext> {
  const auth = await requireAuth(event);
  if (auth.role !== 'admin') throw new ApiError(403, 'Admin access required');
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
  catch { throw new ApiError(400, 'Invalid JSON body'); }
}

export async function readValidatedBody<T>(event: ApiEvent, schema: ZodType<T>): Promise<T> {
  const body   = await readBody(event);
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiError(422, JSON.stringify(result.error.flatten().fieldErrors), result.error.flatten());
  return result.data;
}

export function getValidatedQuery<T>(event: ApiEvent, schema: ZodType<T>): T {
  const result = schema.safeParse(getQuery(event));
  if (!result.success) throw new ApiError(422, 'Invalid query parameters', result.error.flatten());
  return result.data;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
