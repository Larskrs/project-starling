import { ref, watch, type Ref } from 'vue'

const STORAGE_KEY = 'starling-color-mode'

// Module-level so all callers share the same reactive state
const isDark = ref(false)

function apply(dark: boolean): void {
  document.documentElement.classList.toggle('dark', dark)
}

function init(): void {
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

export interface ColorModeContext {
  isDark: Ref<boolean>
  toggle: () => void
  setDark: (val: boolean) => void
}

export function useColorMode(): ColorModeContext {
  function toggle() { isDark.value = !isDark.value }
  function setDark(val: boolean) { isDark.value = val }
  return { isDark, toggle, setDark }
}
