import { reactive, watch } from 'vue'

const KEY = 'starling-debug'

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} }
}

export const debugConfig = reactive({
  fetchDelay: 0,
  ...load(),
})

watch(debugConfig, (v) => {
  localStorage.setItem(KEY, JSON.stringify({ ...v }))
}, { deep: true })

export function resetDebugConfig() {
  debugConfig.fetchDelay = 0
}
