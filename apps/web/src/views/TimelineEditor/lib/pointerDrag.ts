/**
 * Pointer-drag factory with a movement threshold — the one drag primitive
 * behind every drag surface in the editor (clip move/crop, lane chips, track
 * reorder). Pointer events, so mouse and touch both work.
 *
 *   const start = createDrag({ threshold, onStart, onMove, onEnd })
 *   <div @pointerdown="start($event, item)">
 *
 * - threshold: px of movement before onMove starts firing (0 = immediate)
 * - onStart(event, ctx)                  — on pointerdown, before any movement
 * - onMove({ dx, dy, event }, ctx)       — after the threshold is crossed
 * - onEnd({ dx, dy, moved, event }, ctx) — on release; moved = threshold crossed
 *
 * The optional ctx passed to the returned handler rides along to every
 * callback, so a single handler can serve many items (chips, tracks).
 * Window-level listeners attach for the drag's lifetime and always detach.
 */
export interface DragMove {
  dx: number
  dy: number
  event: PointerEvent
}

export interface DragEnd extends DragMove {
  /** Whether the movement threshold was ever crossed. */
  moved: boolean
}

export interface DragOptions<C = unknown> {
  /** px of movement before onMove starts firing (0 = immediate). */
  threshold?: number
  onStart?: (event: PointerEvent, ctx: C) => void
  onMove?: (move: DragMove, ctx: C) => void
  onEnd?: (end: DragEnd, ctx: C) => void
}

export function createDrag<C = unknown>({ threshold = 3, onStart, onMove, onEnd }: DragOptions<C> = {}) {
  return function start(e: PointerEvent, ctx: C): void {
    if (e.button !== 0) return
    const startX = e.clientX
    const startY = e.clientY
    let moved = false

    onStart?.(e, ctx)

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!moved && Math.abs(dx) < threshold && Math.abs(dy) < threshold) return
      moved = true
      onMove?.({ dx, dy, event: ev }, ctx)
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      onEnd?.({ dx: ev.clientX - startX, dy: ev.clientY - startY, moved, event: ev }, ctx)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }
}
