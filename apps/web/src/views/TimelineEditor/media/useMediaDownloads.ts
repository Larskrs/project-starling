/**
 * Reactive view over the media download registry (`mediaDownloads.js`).
 *
 * The registry is a plain observable so the audio engine can import it outside
 * a bundler; this module is the only place that bridges it into Vue. One
 * module-level subscription feeds a single snapshot ref, and every consumer —
 * the download island, and one lookup per on-screen clip — derives from that,
 * so a hundred mounted clips still cost one listener and one array copy per
 * (coalesced) progress notification.
 */

import { shallowRef, computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { subscribeDownloads, downloadEntries, type DownloadEntry } from './mediaDownloads'

const _snapshot = shallowRef<DownloadEntry[]>([])
let _subscribed = false

// Subscribed on first use and never torn down: the registry outlives any single
// editor mount (it is a module singleton), and the listener is one array copy.
function _ensureSubscribed(): void {
  if (_subscribed) return
  _subscribed = true
  subscribeDownloads(() => { _snapshot.value = downloadEntries() })
  _snapshot.value = downloadEntries()
}

// Shared across every clip — built once per snapshot rather than once per clip.
const _byId = computed(() => {
  const map = new Map<string, DownloadEntry>()
  for (const entry of _snapshot.value) map.set(entry.fileId, entry)
  return map
})

const isActive = (entry: DownloadEntry): boolean =>
  entry.status === 'downloading' || entry.status === 'decoding'

/**
 * The download state of one file, or null when nothing has requested it.
 */
export function useFileDownload(
  fileId: MaybeRefOrGetter<string | null | undefined>,
): ComputedRef<DownloadEntry | null> {
  _ensureSubscribed()
  return computed(() => {
    const id = toValue(fileId)
    return id ? _byId.value.get(id) ?? null : null
  })
}

/** The whole queue, plus the aggregates the download island renders. */
export function useDownloadQueue() {
  _ensureSubscribed()

  const entries = computed(() => _snapshot.value)
  const active  = computed(() => entries.value.filter(isActive))
  const failed  = computed(() => entries.value.filter(e => e.status === 'error'))
  const done    = computed(() => entries.value.filter(e => e.status === 'ready'))

  // How far through the work that is STILL RUNNING, weighted by bytes so one
  // big file doesn't jump to "50%" the moment a small one finishes.
  //
  // Deliberately over the in-flight set rather than every entry: completed
  // entries are pruned a few seconds after they land, and counting them would
  // make the bar lurch backwards each time one aged out of the denominator.
  // Files whose size isn't known yet are excluded rather than counted as
  // zero-length — otherwise the bar would race to 100%, then fall back as
  // Content-Length arrived.
  const progress = computed(() => {
    const list = active.value
    if (!list.length) return 1
    let loaded = 0
    let total  = 0
    for (const entry of list) {
      if (!entry.total) continue
      total  += entry.total
      // Decoding means every byte is in — it just isn't playable yet.
      loaded += entry.status === 'decoding' ? entry.total : Math.min(entry.loaded, entry.total)
    }
    return total > 0 ? Math.min(1, loaded / total) : 0
  })

  return { entries, active, failed, done, progress }
}
