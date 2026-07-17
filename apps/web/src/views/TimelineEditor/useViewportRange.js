import { computed, inject, ref } from 'vue'

/**
 * Visible horizontal px range of the editor canvas, widened by a margin.
 * Reads the shared `editor-viewport` ({ scrollLeft, width }, rAF-throttled in
 * index.vue) so every culling site — ruler ticks, lane chips, clips, waveform
 * chunks — uses the same coordinates and fallbacks.
 *
 * Coordinates are px from the timeline's left edge (canvas scrollLeft space).
 */
export function useViewportRange(marginPx = 0) {
  const viewport = inject('editor-viewport', ref({ scrollLeft: 0, width: 0 }))
  return computed(() => {
    const vw = viewport.value
    return {
      left:  vw.scrollLeft - marginPx,
      right: vw.scrollLeft + (vw.width || 1600) + marginPx,
    }
  })
}
