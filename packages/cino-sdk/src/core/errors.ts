/** A request the server refused, or one that never reached it (`status` 0). */
export class CinoApiError extends Error {
  readonly status: number;
  /** The server's error key, e.g. `errors.auth.tokenExpired` or `errors.track.locked`. */
  readonly errorKey: string | null;
  readonly data: unknown;

  constructor(status: number, message: string, errorKey: string | null = null, data: unknown = null) {
    super(message);
    this.name = 'CinoApiError';
    this.status = status;
    this.errorKey = errorKey;
    this.data = data;
  }

  /** The token is invalid, expired, revoked, or not allowed here. */
  get isAuth(): boolean {
    return this.errorKey?.startsWith('errors.auth.') ?? false;
  }

  /** The permission the token's role is missing, e.g. `MANAGE_STORAGE`. */
  get missingPermission(): string | null {
    const data = this.data as { missingPermission?: unknown } | null;
    return typeof data?.missingPermission === 'string' ? data.missingPermission : null;
  }

  /** Sending the same request again cannot succeed. */
  get isFatal(): boolean {
    return this.isAuth || this.status === 403 || this.status === 404;
  }

  static async fromResponse(response: Response, request: string): Promise<CinoApiError> {
    let payload: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(await response.text());
      if (parsed && typeof parsed === 'object') payload = parsed as Record<string, unknown>;
    } catch {
      // not JSON
    }

    const message = typeof payload.message === 'string' ? payload.message
      : typeof payload.error === 'string' ? payload.error
      : `${request} failed (${response.status})`;

    const errorKey = typeof payload.errorKey === 'string' ? payload.errorKey : null;
    return new CinoApiError(response.status, message, errorKey, payload.data ?? null);
  }
}
