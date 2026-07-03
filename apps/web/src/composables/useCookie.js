import { ref, watch } from 'vue'

function readCookie(name) {
  const match = document.cookie
    .split('; ')
    .find(row => row.startsWith(name + '='))
  if (!match) return null
  try { return decodeURIComponent(match.slice(name.length + 1)) }
  catch { return null }
}

function writeCookie(name, value, days) {
  const expires = new Date(Date.now() + days * 86400_000).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
}

/**
 * A ref persisted to a cookie as JSON. Reads the cookie once on creation and
 * writes back on every change (deep — objects like { id: height } work).
 *
 *   const trackHeights = useCookie('editor-track-heights', {})
 *   trackHeights.value = { ...trackHeights.value, [id]: 64 }
 */
export function useCookie(name, defaultValue, { days = 365 } = {}) {
  let initial = defaultValue
  const raw = readCookie(name)
  if (raw !== null) {
    try { initial = JSON.parse(raw) } catch {}
  }

  const value = ref(initial)
  watch(value, v => writeCookie(name, JSON.stringify(v), days), { deep: true })
  return value
}
