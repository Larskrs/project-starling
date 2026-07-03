import { ref } from 'vue'

const clamp = (v, min, max) => Math.max(min, Math.min(max, v))

/**
 * Generic pointer-drag resizing along one axis. One resizer instance can drive
 * many targets (e.g. every track row) — the target is bound per drag.
 *
 *   const sidebar = useResizable({ axis: 'x', min: 160, max: 480 })
 *   <ResizeHandle axis="x" @pointerdown="sidebar.start($event, { value: sidebarWidth })" />
 *
 *   const rows = useResizable({ axis: 'y', min: 32, max: 120 })
 *   rows.start(e, { get: () => heights[id], set: h => setHeight(id, h) })
 *
 * @param {'x'|'y'} axis    drag axis (x → widths, y → heights)
 * @param {number}  min/max value clamp
 * @param {boolean} invert  dragging toward the origin grows the value
 *                          (e.g. a handle on the LEFT edge of a right panel)
 */
export function useResizable({ axis = 'x', min = 0, max = Infinity, invert = false } = {}) {
  const resizing = ref(false)

  let _startPos   = 0
  let _startValue = 0
  let _set        = null
  let _onEnd      = null

  function onMove(e) {
    const pos   = axis === 'x' ? e.clientX : e.clientY
    const delta = (pos - _startPos) * (invert ? -1 : 1)
    _set(clamp(Math.round(_startValue + delta), min, max))
  }

  function onUp() {
    resizing.value = false
    window.removeEventListener('pointermove', onMove)
    _onEnd?.()
    _set   = null
    _onEnd = null
  }

  /**
   * Begin a drag. Target is either a ref ({ value }) or a { get, set } pair;
   * optional onEnd fires once the pointer is released.
   */
  function start(e, { value, get, set, onEnd } = {}) {
    e.preventDefault()
    const getter = get ?? (() => value.value)
    _set         = set ?? (v => { value.value = v })
    _onEnd       = onEnd ?? null
    _startPos    = axis === 'x' ? e.clientX : e.clientY
    _startValue  = getter()
    resizing.value = true
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }

  return { resizing, start }
}
