import { ref, watch, type Ref } from 'vue'

/**
 * A ref persisted to localStorage as JSON. Reads once on creation and writes
 * back on every change (deep — objects like { id: height } work).
 *
 *   const trackHeights = useLocalStorage('editor-track-heights', {})
 *   trackHeights.value = { ...trackHeights.value, [id]: 64 }
 *
 * This replaces the old cookie-backed version for every client-only editor
 * preference. Cookies were the wrong store for these: the browser attaches them
 * to EVERY request to the origin, so per-track heights, mute flags and remembered
 * scroll positions were being uploaded on every API call and every asset fetch,
 * and the whole set had to stay inside the ~4KB cookie budget it shared with the
 * session. None of it is ever read by the server.
 *
 * The session cookie is deliberately NOT part of this: it is set server-side and
 * HttpOnly, which is what keeps it out of reach of scripts. Authentication must
 * stay there — moving a session token into localStorage would hand it to any
 * XSS on the page.
 */

function readRaw(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

/**
 * Value left behind in a cookie by the previous implementation, if any.
 * Read once per key so the editor reopens the way people left it, then the
 * cookie is dropped so it stops riding along on every request.
 */
function takeLegacyCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.split('; ').find(row => row.startsWith(name + '='))
  if (!match) return null

  let value: string | null = null
  try { value = decodeURIComponent(match.slice(name.length + 1)) } catch { /* unusable */ }
  // Expire it whether or not it decoded — either way it has no further use.
  document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`
  return value
}

export function useLocalStorage<T>(key: string, defaultValue: T): Ref<T> {
  let initial = defaultValue

  const raw = readRaw(key) ?? takeLegacyCookie(key)
  if (raw !== null) {
    try { initial = JSON.parse(raw) as T } catch { /* keep the default */ }
  }

  const value = ref(initial) as Ref<T>
  watch(value, v => {
    // Private mode and full quotas both throw; a lost preference must never
    // take an edit session down with it.
    try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* not persisted */ }
  }, { deep: true })

  return value
}
