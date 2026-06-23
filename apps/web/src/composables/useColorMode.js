import { ref, watch } from 'vue'

const STORAGE_KEY = 'starling-color-mode'

// Module-level so all callers share the same reactive state
const isDark = ref(false)

function apply(dark) {
  document.documentElement.classList.toggle('dark', dark)
}

function init() {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    isDark.value = stored === 'dark'
  } else {
    isDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  apply(isDark.value)
}

init()

watch(isDark, (val) => {
  apply(val)
  localStorage.setItem(STORAGE_KEY, val ? 'dark' : 'light')
})

export function useColorMode() {
  function toggle() { isDark.value = !isDark.value }
  function setDark(val) { isDark.value = val }
  return { isDark, toggle, setDark }
}
