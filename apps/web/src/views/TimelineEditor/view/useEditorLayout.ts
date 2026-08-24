import { computed, type Ref } from 'vue'
import { useLocalStorage } from '../../../composables/useLocalStorage'
import { useResizable } from '../../../composables/useResizable'
import { clamp } from '../lib/editorUtils'
import { RULER_TRACK_HEIGHT, BPM_TRACK_HEIGHT } from '../behaviors/trackSettings'
import type { TrackSettings, TrackWithType } from '../../../types/timeline'

export const TRACK_HEIGHT_DEFAULT = 56
export const TRACK_HEIGHT_MIN     = 32
export const TRACK_HEIGHT_MAX     = 256

export interface EditorLayoutOptions {
  tracks: Ref<TrackWithType[]>
  settingsFor: (track: TrackWithType) => TrackSettings
  /** Called when the sidebar drag changes the canvas width. */
  onSidebarResize: () => void
}

/**
 * Sidebar width and per-track row heights, both persisted locally so the
 * editor reopens the shape you left it in.
 *
 * Strip tracks (ruler, BPM) have a fixed height and are not resizable — they
 * are header-like furniture, not content rows.
 */
export function useEditorLayout({ tracks, settingsFor, onSidebarResize }: EditorLayoutOptions) {
  const sidebarWidth = useLocalStorage('editor-sidebar-width', 264)
  const trackHeights = useLocalStorage<Record<string, number>>('editor-track-heights', {})

  function trackHeight(track: TrackWithType): number {
    const display = settingsFor(track).trackDisplay
    if (display === 'ruler') return RULER_TRACK_HEIGHT
    if (display === 'bpm')   return BPM_TRACK_HEIGHT
    return clamp(trackHeights.value[track.id] ?? TRACK_HEIGHT_DEFAULT, TRACK_HEIGHT_MIN, TRACK_HEIGHT_MAX)
  }

  const totalTracksHeight = computed(() =>
    tracks.value.reduce((sum, tr) => sum + trackHeight(tr), 0),
  )

  const sidebarResizer = useResizable({ axis: 'x', min: 200, max: 480 })
  const rowResizer     = useResizable({ axis: 'y', min: TRACK_HEIGHT_MIN, max: TRACK_HEIGHT_MAX })

  function startSidebarResize(e: PointerEvent): void {
    sidebarResizer.start(e, {
      value: sidebarWidth,
      // The canvas width changes with the sidebar — keep the viewport fresh so
      // waveforms don't rasterise against a stale window.
      set: (v) => { sidebarWidth.value = v; onSidebarResize() },
      get: () => sidebarWidth.value,
    })
  }

  function startRowResize(track: TrackWithType, e: PointerEvent): void {
    rowResizer.start(e, {
      get: () => trackHeight(track),
      set: (h) => { trackHeights.value = { ...trackHeights.value, [track.id]: h } },
    })
  }

  return {
    sidebarWidth, trackHeights, trackHeight, totalTracksHeight,
    sidebarResizer, rowResizer, startSidebarResize, startRowResize,
  }
}

export type EditorLayoutApi = ReturnType<typeof useEditorLayout>
