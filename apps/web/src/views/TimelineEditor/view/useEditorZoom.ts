import { ref, computed, nextTick, onMounted, onUnmounted, type Ref } from 'vue'
import { clamp, RULER_TICK_TARGET_PX } from '../lib/editorUtils'
import type { Timeline } from '../../../types/api'

/**
 * Timeline zoom: one range (fit-the-whole-timeline … MAX_PX_PER_FRAME, so the
 * range adapts to length) driven two ways.
 *
 *  - alt + wheel — CONTINUOUS exponential scaling, normalised per device and
 *    coalesced to one zoom per frame, so trackpads feel smooth and mouse
 *    notches feel sane
 *  - toolbar / keyboard — a ladder of ZOOM_STOPS geometric stops
 *
 * The default puts ruler ticks at 5-minute intervals, and the readout is a
 * position in the range (0–100%) so the number stays small however long the
 * timeline is.
 */
const MAX_PX_PER_FRAME = 16
const ZOOM_STOPS       = 50
const WHEEL_ZOOM_RATE  = 0.003   // exp factor per normalised wheel px
// Trackpad pinch reports far smaller per-event deltas than a wheel notch, so it
// is amplified to cover a comparable zoom range in one comfortable gesture.
const PINCH_ZOOM_GAIN  = 4

export interface EditorZoomOptions {
  timeline: Ref<Timeline | null>
  canvasRef: Ref<HTMLElement | null>
  /**
   * Transport state, read at zoom time rather than taken as refs. Playback owns
   * those refs but is created AFTER this composable — it needs `pxPerFrame`
   * from here — so at setup the caller has nothing to hand over yet. Only
   * `setZoom` reads them, and never before the first user gesture.
   */
  playheadFrame: () => number
  isPlaying: () => boolean
  updateViewport: () => void
}

export function useEditorZoom(
  { timeline, canvasRef, playheadFrame, isPlaying, updateViewport }: EditorZoomOptions,
) {
  /** Set to the 5-minute-tick default once the timeline loads. */
  const pxPerFrame = ref(1)

  const timelineWidth = computed(() =>
    timeline.value ? (timeline.value.endFrame - timeline.value.startFrame) * pxPerFrame.value : 0,
  )

  /** Zoom at which the whole timeline fits the canvas. */
  function minPxPerFrame(): number {
    const frames = timeline.value ? timeline.value.endFrame - timeline.value.startFrame : 0
    const width  = canvasRef.value?.clientWidth || 1200
    return frames > 0 ? Math.min(width / frames, MAX_PX_PER_FRAME) : 0.01
  }

  /** Default zoom: one ruler tick ≈ 5 minutes. */
  function defaultPxPerFrame(): number {
    const fps = parseFloat(timeline.value?.frameRate ?? '') || 25
    return clamp(RULER_TICK_TARGET_PX / (fps * 300), minPxPerFrame(), MAX_PX_PER_FRAME)
  }

  function setZoom(px: number, anchorClientX: number | null = null): void {
    if (!timeline.value) return
    px = clamp(px, minPxPerFrame(), MAX_PX_PER_FRAME)
    if (px === pxPerFrame.value) return

    const canvas = canvasRef.value
    if (!canvas) { pxPerFrame.value = px; return }

    // Keep the frame under the anchor stationary: the cursor when given; else
    // the playhead while playing (auto-follow chases it anyway — a centre
    // anchor would yank it off screen); else the viewport centre.
    let anchorX: number
    if (anchorClientX != null) {
      anchorX = anchorClientX - canvas.getBoundingClientRect().left
    } else {
      const playheadPx =
        (playheadFrame() - timeline.value.startFrame) * pxPerFrame.value - canvas.scrollLeft
      anchorX = (isPlaying() && playheadPx >= 0 && playheadPx <= canvas.clientWidth)
        ? playheadPx
        : canvas.clientWidth / 2
    }
    const anchorFrame = timeline.value.startFrame + (canvas.scrollLeft + anchorX) / pxPerFrame.value

    pxPerFrame.value = px

    nextTick(() => {
      if (!timeline.value) return
      canvas.scrollLeft = (anchorFrame - timeline.value.startFrame) * px - anchorX
      updateViewport()
    })
  }

  /** The stop ladder, rebuilt on demand — its floor moves with the canvas width. */
  function zoomStops(): number[] {
    const min   = minPxPerFrame()
    const ratio = MAX_PX_PER_FRAME / min
    if (ratio <= 1) return [min]
    const stops: number[] = []
    for (let i = 0; i < ZOOM_STOPS; i++) stops.push(min * Math.pow(ratio, i / (ZOOM_STOPS - 1)))
    return stops
  }

  function nearestStopIndex(stops: number[], px: number): number {
    let best = 0, bestD = Infinity
    for (let i = 0; i < stops.length; i++) {
      const d = Math.abs(Math.log(stops[i]! / px))
      if (d < bestD) { bestD = d; best = i }
    }
    return best
  }

  function stepZoom(steps: number, anchorClientX: number | null = null): void {
    const stops = zoomStops()
    const i     = nearestStopIndex(stops, pxPerFrame.value)
    setZoom(stops[clamp(i + steps, 0, stops.length - 1)]!, anchorClientX)
  }

  const zoomIn    = (): void => stepZoom(1)
  const zoomOut   = (): void => stepZoom(-1)
  const zoomFit   = (): void => setZoom(minPxPerFrame())
  const zoomReset = (): void => setZoom(defaultPxPerFrame())

  /** Position on the ladder — 0% fits the timeline, 100% is maximum detail. */
  const zoomLabel = computed(() => {
    if (!timeline.value) return ''
    const min   = minPxPerFrame()
    const ratio = MAX_PX_PER_FRAME / min
    if (ratio <= 1) return '100%'
    const pct = Math.round(100 * Math.log(pxPerFrame.value / min) / Math.log(ratio))
    return `${clamp(pct, 0, 100)}%`
  })

  // ── Zoom gestures: alt + wheel, and trackpad pinch ───────────────────────
  // Alt+wheel is the timeline's own zoom modifier, anchored at the cursor when
  // it is over the canvas. Trackpad pinch (ctrl+wheel) zooms too, but only over
  // the canvas — see isPinchOverCanvas for why that narrowing matters. Deltas
  // are normalised (line/page deltaModes → px) and coalesced to one setZoom per
  // frame, so a fast burst costs one re-render.
  //
  // The default is prevented for alt+wheel as well as pinch: Firefox maps that
  // gesture to history navigation on Windows, which would otherwise walk out of
  // the editor mid-zoom.
  let wheelFactor = 1
  let wheelAnchor: number | null = null
  let wheelRaf: number | null = null

  /**
   * Trackpad pinch, which every browser reports as ctrl+wheel.
   *
   * This used to be rejected outright so browser page zoom kept working. That
   * reasoning holds for the page as a whole, but it left MACBOOK USERS WITH NO
   * ZOOM GESTURE AT ALL: a trackpad has no wheel, so alt+wheel — the timeline's
   * own zoom modifier — is unreachable, and pinch is the only thing a Mac user
   * would think to try.
   *
   * So pinch is claimed, but ONLY while the pointer is over the timeline canvas.
   * Anywhere else in the editor — the track headers, the toolbar, a dialog —
   * ctrl+wheel still page-zooms exactly as it does on any other site, which is
   * what the original decision was protecting.
   */
  function isPinchOverCanvas(e: WheelEvent): boolean {
    if (!e.ctrlKey || e.metaKey || e.altKey) return false
    return e.target instanceof Node && !!canvasRef.value?.contains(e.target)
  }

  function onGlobalWheel(e: WheelEvent): void {
    const pinch = isPinchOverCanvas(e)
    if (!pinch && (!e.altKey || e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    // A pinch arrives with much smaller deltas than a wheel notch, so it needs
    // amplifying to cover the same range in a comfortable gesture.
    const gain = pinch ? PINCH_ZOOM_GAIN : 1
    const deltaPx = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1) * gain
    wheelFactor *= Math.exp(-deltaPx * WHEEL_ZOOM_RATE)
    if (e.target instanceof Node && canvasRef.value?.contains(e.target)) wheelAnchor = e.clientX

    if (wheelRaf) return
    wheelRaf = requestAnimationFrame(() => {
      wheelRaf = null
      const factor = wheelFactor
      const anchor = wheelAnchor
      wheelFactor = 1
      wheelAnchor = null
      setZoom(pxPerFrame.value * factor, anchor)
    })
  }

  onMounted(() => {
    document.addEventListener('wheel', onGlobalWheel, { passive: false })
  })

  onUnmounted(() => {
    document.removeEventListener('wheel', onGlobalWheel)
    if (wheelRaf) { cancelAnimationFrame(wheelRaf); wheelRaf = null }
  })

  return {
    pxPerFrame, timelineWidth, zoomLabel,
    minPxPerFrame, defaultPxPerFrame,
    setZoom, zoomIn, zoomOut, zoomFit, zoomReset,
  }
}

export type EditorZoomApi = ReturnType<typeof useEditorZoom>
