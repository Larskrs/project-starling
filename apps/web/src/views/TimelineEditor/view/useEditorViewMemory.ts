import { watch, onScopeDispose, type Ref } from 'vue'
import { useCookie } from '../../../composables/useCookie'
import type { EditorViewport } from '../../../types/timeline'
import type { Timeline } from '../../../types/api'

/** Where you were last time, per timeline. */
interface SavedView {
  /** pxPerFrame. */
  z: number
  /** scrollLeft. */
  s: number
}

/** Beyond this many timelines the oldest entries are dropped to keep the cookie small. */
const MAX_REMEMBERED = 20
const SAVE_DEBOUNCE_MS = 800

export interface ViewMemoryOptions {
  timeline: Ref<Timeline | null>
  loading: Ref<boolean>
  pxPerFrame: Ref<number>
  viewport: Ref<EditorViewport>
  canvasRef: Ref<HTMLElement | null>
}

/**
 * Remembers zoom and scroll per timeline, so reopening one puts you back where
 * you were rather than at the 5-minute default.
 */
export function useEditorViewMemory(
  { timeline, loading, pxPerFrame, viewport, canvasRef }: ViewMemoryOptions,
) {
  const savedViews = useCookie<Record<string, SavedView>>('editor-views', {})

  /** The remembered view for a timeline, or null if it has none. */
  function viewFor(timelineId: string): SavedView | null {
    return savedViews.value[timelineId] ?? null
  }

  function save(): void {
    if (!timeline.value) return
    const entries: Record<string, SavedView> = {
      ...savedViews.value,
      [timeline.value.id]: {
        z: pxPerFrame.value,
        s: Math.round(canvasRef.value?.scrollLeft ?? 0),
      },
    }
    const keys = Object.keys(entries)
    while (keys.length > MAX_REMEMBERED) delete entries[keys.shift()!]
    savedViews.value = entries
  }

  let timer: ReturnType<typeof setTimeout> | null = null

  function cancelPending(): void {
    if (timer) { clearTimeout(timer); timer = null }
  }

  /**
   * Save now, cancelling any debounced save. Call on the way out: without it a
   * zoom or scroll in the last 800ms before leaving is lost.
   */
  function flush(): void {
    cancelPending()
    save()
  }

  watch([pxPerFrame, viewport], () => {
    if (loading.value || !timeline.value) return
    cancelPending()
    timer = setTimeout(save, SAVE_DEBOUNCE_MS)
  })

  // The timer outlives the component otherwise, and would fire after unmount to
  // write the view of a timeline the user has already left. The composable owns
  // the timer, so it owns clearing it — callers shouldn't have to know it exists.
  onScopeDispose(cancelPending)

  return { viewFor, save, flush }
}
