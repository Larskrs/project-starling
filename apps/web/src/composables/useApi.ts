import { useI18n } from 'vue-i18n'
import { useToast } from '@starling/ui/useToast'
import { debugConfig } from '@starling/ui/debugConfig'

export interface FetchOptions extends Omit<RequestInit, 'body' | 'headers'> {
  /** Serialised to a JSON body, with the Content-Type set for you. */
  json?: unknown
  /** Suppress the automatic error toast. */
  silent?: boolean
  headers?: Record<string, string>
  body?: BodyInit | null
}

/**
 * A discriminated union, so `if (!ok) return` narrows `data` to non-null for
 * the rest of the caller — the failure branch can't be skipped by accident.
 */
export type FetchResult<T> =
  | { ok: true;  status: number; data: T;    error: null }
  | { ok: false; status: number; data: null; error: string }

/** The error envelope the API sends on a non-2xx response. */
interface ApiError {
  message?: string
  error?: string
  /** i18n key, preferred over `message` when the client knows it. */
  errorKey?: string
}

/**
 * Wraps fetch with:
 * - credentials: 'include' by default
 * - automatic JSON body serialisation via the `json` option
 * - error message extraction from the API response body
 * - automatic toast on non-ok responses (suppress with { silent: true })
 *
 * Never throws.
 *
 * @example
 * const { $fetch } = useApi()
 * const { ok, data } = await $fetch<Timeline[]>('/api/timelines')
 * if (!ok) return
 * data.forEach(...)   // data is Timeline[] here, not Timeline[] | null
 */
export function useApi() {
  const toast     = useToast()
  const { t, te } = useI18n()

  async function $fetch<T = any>(url: string, options: FetchOptions = {}): Promise<FetchResult<T>> {
    const { silent = false, json: jsonBody, headers: extraHeaders, ...rest } = options

    const headers: Record<string, string> = { ...extraHeaders }
    if (jsonBody !== undefined) headers['Content-Type'] = 'application/json'

    const init: RequestInit = {
      credentials: 'include',
      headers,
      ...rest,
      ...(jsonBody !== undefined ? { body: JSON.stringify(jsonBody) } : {}),
    }

    let res: Response
    try {
      res = await fetch(url, init)
      if (debugConfig.fetchDelay > 0) await new Promise(r => setTimeout(r, debugConfig.fetchDelay))
    } catch {
      const error = 'Network error — check your connection'
      if (!silent) toast.error(error)
      return { ok: false, status: 0, data: null, error }
    }

    let data: unknown = null
    if (res.status !== 204) {
      try { data = await res.json() } catch { /* empty or non-JSON body */ }
    }

    if (!res.ok) {
      const body  = (data ?? {}) as ApiError
      const raw   = body.message ?? body.error ?? `Request failed (${res.status})`
      const error = body.errorKey && te(body.errorKey) ? t(body.errorKey) : raw
      if (!silent) {
        if (res.status === 401 || res.status === 403) toast.auth(error)
        else toast.error(error)
      }
      return { ok: false, status: res.status, data: null, error }
    }

    return { ok: true, status: res.status, data: data as T, error: null }
  }

  return { $fetch }
}
