import { useToast } from '@starling/ui/useToast'

/**
 * Wraps fetch with:
 * - credentials: 'include' by default
 * - automatic JSON body serialisation via the `json` option
 * - error message extraction from the API response body
 * - automatic toast on non-ok responses (suppress with { silent: true })
 *
 * Returns { ok, status, data, error } — never throws.
 *
 * @example
 * const { $fetch } = useApi()
 * const { ok, data } = await $fetch('/api/...', { method: 'POST', json: { name } })
 */
export function useApi() {
  const toast = useToast()

  async function $fetch(url, options = {}) {
    const { silent = false, json: jsonBody, headers: extraHeaders, ...rest } = options

    const headers = { ...extraHeaders }
    if (jsonBody !== undefined) headers['Content-Type'] = 'application/json'

    const init = {
      credentials: 'include',
      headers,
      ...rest,
      ...(jsonBody !== undefined ? { body: JSON.stringify(jsonBody) } : {}),
    }

    let res
    try {
      res = await fetch(url, init)
    } catch {
      const error = 'Network error — check your connection'
      if (!silent) toast.error(error)
      return { ok: false, status: 0, data: null, error }
    }

    let data = null
    if (res.status !== 204) {
      try { data = await res.json() } catch {}
    }

    if (!res.ok) {
      const error = data?.message ?? data?.error ?? `Request failed (${res.status})`
      if (!silent) {
        if (res.status === 401) toast.auth('Sign in required')
        else if (res.status === 403) toast.auth(error)
        else toast.error(error)
      }
      return { ok: false, status: res.status, data: null, error }
    }

    return { ok: true, status: res.status, data, error: null }
  }

  return { $fetch }
}
