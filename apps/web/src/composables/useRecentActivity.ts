import { ref } from 'vue'
import { useApi } from './useApi'
import type { RecentActivityResponse, RecentProduction, RecentTimeline } from '../types/api'

// Module-level state — the home page renders recent timelines and recent
// projects as two separate cards, but they come from one endpoint and must not
// cost two requests.
const timelines   = ref<RecentTimeline[]>([])
const productions = ref<RecentProduction[]>([])
const loading     = ref(true)
const error       = ref('')

let inflight: Promise<void> | null = null
let loadedAt = 0

// Requests inside this window reuse what's already loaded, so sibling cards
// mounting together share one fetch. Longer than a mount cycle, short enough
// that returning to the home page shows a fresh list.
const FRESH_MS = 10_000

/**
 * The signed-in user's recently opened timelines and productions, newest
 * first. Fed by the API's activity log — opening a timeline (socket join or
 * bootstrap fetch) or a production page is what puts it here.
 */
export function useRecentActivity() {
  const { $fetch } = useApi()

  function load({ force = false } = {}): Promise<void> {
    if (inflight) return inflight
    if (!force && Date.now() - loadedAt < FRESH_MS) return Promise.resolve()

    loading.value = true
    error.value   = ''

    inflight = $fetch<RecentActivityResponse>('/api/activity/recent', { silent: true }).then(({ ok, data }) => {
      inflight      = null
      loading.value = false
      if (!ok) { error.value = 'activity.failedToLoad'; return }
      timelines.value   = data.timelines ?? []
      productions.value = data.productions ?? []
      loadedAt = Date.now()
    })

    return inflight
  }

  return { timelines, productions, loading, error, load }
}
