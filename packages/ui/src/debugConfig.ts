import { reactive, watch } from 'vue'

const KEY = 'starling-debug'

export interface DebugConfig {
  /** Artificial delay in ms added to every $fetch and image load. */
  fetchDelay: number
}

const DEFAULTS: DebugConfig = { fetchDelay: 0 }

function load(): Partial<DebugConfig> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<DebugConfig> } catch { return {} }
}

export const debugConfig = reactive<DebugConfig>({ ...DEFAULTS, ...load() })

watch(debugConfig, (v) => {
  localStorage.setItem(KEY, JSON.stringify({ ...v }))
}, { deep: true })

export function resetDebugConfig(): void {
  Object.assign(debugConfig, DEFAULTS)
}
