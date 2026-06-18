export const apiBase = import.meta.env.VITE_API_BASE_URL ?? ''

export function apiFetch(path, opts) {
  return fetch(`${apiBase}${path}`, opts)
}
