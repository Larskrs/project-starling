import { ref, onMounted, onUnmounted } from 'vue'
import type { EditorViewport } from '../../../types/timeline'

/**
 * The two scroll containers and the visible px window shared with everything
 * that culls by viewport (clip waveforms, ruler ticks, lane chips).
 *
 * Updates are rAF-coalesced: a scroll burst yields one update per frame, so a
 * hundred mounted clips re-derive their visible slice once rather than once per
 * event.
 */
export function useEditorViewport() {
  /** The horizontally scrolling timeline canvas. */
  const canvasRef = ref<HTMLElement | null>(null)
  /** Track headers — follows the canvas vertically, never scrolls on its own. */
  const trackHeadersRef = ref<HTMLElement | null>(null)

  const viewport = ref<EditorViewport>({ scrollLeft: 0, width: 0 })

  let raf: number | null = null

  function updateViewport(): void {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = null
      const el = canvasRef.value
      if (el) viewport.value = { scrollLeft: el.scrollLeft, width: el.clientWidth }
    })
  }

  /** Keep the headers pinned to the canvas's vertical scroll. */
  function onCanvasScroll(): void {
    if (trackHeadersRef.value && canvasRef.value) {
      trackHeadersRef.value.scrollTop = canvasRef.value.scrollTop
    }
    updateViewport()
  }

  onMounted(() => window.addEventListener('resize', updateViewport))
  onUnmounted(() => {
    window.removeEventListener('resize', updateViewport)
    if (raf) { cancelAnimationFrame(raf); raf = null }
  })

  return { canvasRef, trackHeadersRef, viewport, updateViewport, onCanvasScroll }
}

export type EditorViewportApi = ReturnType<typeof useEditorViewport>
