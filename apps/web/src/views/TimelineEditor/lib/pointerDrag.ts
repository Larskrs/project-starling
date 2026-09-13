/**
 * Pointer-drag factory with a movement threshold — the one drag primitive
 * behind every drag surface in the editor (clip move/crop, lane chips, track
 * reorder). Pointer events, so mouse and touch both work.
 *
 *   const start = createDrag({ threshold, onStart, onMove, onEnd })
 *   <div @pointerdown="start($event, item)">
 *
 * - threshold: px of movement before onMove starts firing (0 = immediate)
 * - axis: only movement along this axis counts toward the threshold
 * - scrollContainer: the element the dragged thing scrolls with — see below
 * - autoScroll: scroll that container while the pointer is near its edge
 * - onStart(event, ctx)                             — on pointerdown
 * - onMove({ dx, dy, event }, ctx)                  — after the threshold is crossed
 * - onEnd({ dx, dy, moved, cancelled, event }, ctx) — on release or cancel
 *
 * The optional ctx passed to the returned handler rides along to every
 * callback, so a single handler can serve many items (chips, tracks).
 *
 * A drag always ends. Release, `pointercancel` (touch taken over by the OS),
 * the window losing focus (alt-tab mid-drag) and Escape all finish it, and
 * every listener detaches — a drag that never hears its pointerup would
 * otherwise keep following the mouse after the button is long released.
 * Cancelling reports `moved: false, cancelled: true` with zero deltas, so a
 * handler that ignores unmoved drags needs no extra branch.
 */
export interface DragMove {
  dx: number
  dy: number
  event: PointerEvent
}

export interface DragEnd extends DragMove {
  /** Whether the movement threshold was ever crossed (false when cancelled). */
  moved: boolean
  /** Escape, pointercancel or focus loss ended the drag: apply nothing. */
  cancelled: boolean
}

export interface DragOptions<C = unknown> {
  /** px of movement before onMove starts firing (0 = immediate). */
  threshold?: number
  /** Count only this axis toward the threshold. */
  axis?: 'x' | 'y'
  /**
   * The scroll container the dragged content lives in. Its scroll offset is
   * folded into dx/dy, so whatever is under the pointer stays under it while
   * the view moves beneath — playback auto-follow and edge auto-scroll would
   * otherwise make the drop land somewhere the pointer never was.
   */
  scrollContainer?: () => HTMLElement | null | undefined
  /** Scroll the container horizontally while the pointer is near its edge. */
  autoScroll?: boolean
  onStart?: (event: PointerEvent, ctx: C) => void
  onMove?: (move: DragMove, ctx: C) => void
  onEnd?: (end: DragEnd, ctx: C) => void
}

/** Distance from the container edge (px) where auto-scroll kicks in. */
const EDGE_PX = 40
/** Fastest auto-scroll, px per animation frame, reached at the very edge. */
const MAX_SCROLL_SPEED = 24

export function createDrag<C = unknown>({
  threshold = 3, axis, scrollContainer, autoScroll = false, onStart, onMove, onEnd,
}: DragOptions<C> = {}) {
  return function start(e: PointerEvent, ctx: C): void {
    if (e.button !== 0) return
    const el      = scrollContainer?.() ?? null
    const startX  = e.clientX
    const startY  = e.clientY
    const scrollX = el?.scrollLeft ?? 0
    const scrollY = el?.scrollTop ?? 0
    let moved = false
    let last  = e
    let raf: number | null = null

    onStart?.(e, ctx)

    const deltas = (ev: PointerEvent) => ({
      dx: ev.clientX - startX + ((el?.scrollLeft ?? 0) - scrollX),
      dy: ev.clientY - startY + ((el?.scrollTop ?? 0) - scrollY),
    })

    const crossed = (ev: PointerEvent): boolean => {
      const ax = Math.abs(ev.clientX - startX)
      const ay = Math.abs(ev.clientY - startY)
      if (axis === 'x') return ax >= threshold
      if (axis === 'y') return ay >= threshold
      return ax >= threshold || ay >= threshold
    }

    const emitMove = (): void => {
      if (moved) onMove?.({ ...deltas(last), event: last }, ctx)
    }

    const edgeScroll = (): void => {
      raf = null
      if (!el || !moved) return
      const rect = el.getBoundingClientRect()
      const x    = last.clientX
      let speed  = 0
      if (x < rect.left + EDGE_PX)       speed = -((rect.left + EDGE_PX - x) / EDGE_PX)
      else if (x > rect.right - EDGE_PX) speed =  ((x - (rect.right - EDGE_PX)) / EDGE_PX)
      if (speed === 0) return
      speed = Math.max(-1, Math.min(1, speed)) * MAX_SCROLL_SPEED
      el.scrollLeft += speed   // the scroll listener re-emits the move
      raf = requestAnimationFrame(edgeScroll)
    }

    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId) return
      last = ev
      if (!moved && !crossed(ev)) return
      moved = true
      emitMove()
      if (autoScroll && el && raf === null) raf = requestAnimationFrame(edgeScroll)
    }

    const finish = (cancelled: boolean, ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('blur', cancel)
      window.removeEventListener('keydown', onKey, true)
      el?.removeEventListener('scroll', emitMove)
      if (raf !== null) { cancelAnimationFrame(raf); raf = null }
      if (cancelled) onEnd?.({ dx: 0, dy: 0, moved: false, cancelled: true, event: ev }, ctx)
      else           onEnd?.({ ...deltas(ev), moved, cancelled: false, event: ev }, ctx)
    }

    const up       = (ev: PointerEvent): void => { if (ev.pointerId === e.pointerId) finish(false, ev) }
    const onCancel = (ev: PointerEvent): void => { if (ev.pointerId === e.pointerId) finish(true, ev) }
    const cancel   = (): void => finish(true, last)
    // Capture phase on window, and stopped there: Escape here means "abort the
    // drag", not also "deselect" in the editor's own key handler.
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      ev.stopImmediatePropagation()
      cancel()
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', cancel)
    window.addEventListener('keydown', onKey, true)
    el?.addEventListener('scroll', emitMove, { passive: true })
  }
}
