import { SOCKET_ID_HEADER } from '../protocol.ts';
import { CinoApiError } from './errors.ts';

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
export type Query = Record<string, string | number | boolean | null | undefined>;
export type SocketIdSource = () => string | null | undefined;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  /** Sent on writes so the server's live relay skips the socket that made them. */
  socketId?: string | null;
  signal?: AbortSignal;
}

export interface HttpOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
  /** Give up on a request whose response has not started after this many ms. 0 waits forever. */
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 30_000;

export const encode = (value: string): string => encodeURIComponent(value);

export function normaliseUrl(url: string): string {
  const trimmed = (url ?? '').trim().replace(/\/+$/, '');
  if (!/^(https?|wss?):\/\//i.test(trimmed)) {
    throw new TypeError(`cino-sdk: url must start with http(s):// or ws(s)://, got "${url}"`);
  }
  return trimmed.replace(/^ws(s?):\/\//i, 'http$1://');
}

export class Http {
  readonly baseUrl: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #expiryListeners = new Set<(expiresAt: Date) => void>();
  #tokenExpiresAt: Date | null = null;

  constructor({ baseUrl, token, fetch: fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS }: HttpOptions) {
    this.baseUrl = baseUrl;
    this.#token = token;
    this.#timeoutMs = timeoutMs;
    // Wrapped: a browser's fetch throws "Illegal invocation" when called detached.
    this.#fetch = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  get token(): string {
    return this.#token;
  }

  /** The token's expiry, from the last response that carried it. */
  get tokenExpiresAt(): Date | null {
    return this.#tokenExpiresAt;
  }

  onTokenExpiry(listener: (expiresAt: Date) => void): () => void {
    this.#expiryListeners.add(listener);
    return () => { this.#expiryListeners.delete(listener); };
  }

  url(path: string, query: Query = {}): string {
    const url = new URL(`${this.baseUrl}/api${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async json<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.fetch(method, path, options);
    const text = await response.text();
    if (!text) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      // A captive portal or a misrouted proxy answers 200 with a web page.
      throw new CinoApiError(response.status, `${method} ${path} answered with something that is not JSON`);
    }
  }

  async fetch(method: Method, path: string, options: RequestOptions = {}): Promise<Response> {
    const headers: Record<string, string> = { ...options.headers, Authorization: `Bearer ${this.#token}` };

    let body: BodyInit | undefined;
    if (options.form) {
      body = options.form;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    if (options.socketId && method !== 'GET') headers[SOCKET_ID_HEADER] = options.socketId;

    // The timeout covers waiting for the response to start, not reading its body: a download may take minutes.
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) forwardAbort();
    else options.signal?.addEventListener('abort', forwardAbort, { once: true });
    let timedOut = false;
    const timer = this.#timeoutMs > 0
      ? setTimeout(() => { timedOut = true; controller.abort(); }, this.#timeoutMs)
      : null;

    let response: Response;
    try {
      response = await this.#fetch(this.url(path, options.query), { method, headers, body, signal: controller.signal });
    } catch (err) {
      if (timedOut) throw new CinoApiError(0, `${method} ${path} timed out after ${this.#timeoutMs}ms`);
      if ((err as Error).name === 'AbortError') throw err;
      throw new CinoApiError(0, `${method} ${path} did not reach the server: ${(err as Error).message}`);
    } finally {
      if (timer) clearTimeout(timer);
    }

    this.#readExpiry(response.headers);
    if (!response.ok) throw await CinoApiError.fromResponse(response, `${method} ${path}`);
    return response;
  }

  #readExpiry(headers: Headers): void {
    const raw = headers.get('x-cino-token-expires');
    if (!raw) return;
    const expiresAt = new Date(raw);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() === this.#tokenExpiresAt?.getTime()) return;
    this.#tokenExpiresAt = expiresAt;
    for (const listener of [...this.#expiryListeners]) listener(expiresAt);
  }
}
