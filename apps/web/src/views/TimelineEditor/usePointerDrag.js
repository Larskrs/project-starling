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
export function createDrag({ threshold = 3, onStart, onMove, onEnd } = {}) {
  return function start(e, ctx) {
    if (e.button !== 0) return
    const startX = e.clientX
    const startY = e.clientY
    let moved = false

    onStart?.(e, ctx)

    const move = (ev) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!moved && Math.abs(dx) < threshold && Math.abs(dy) < threshold) return
      moved = true
      onMove?.({ dx, dy, event: ev }, ctx)
    }
    const up = (ev) => {
      window.removeEventListener('pointermove', move)
      onEnd?.({ dx: ev.clientX - startX, dy: ev.clientY - startY, moved, event: ev }, ctx)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }
}
