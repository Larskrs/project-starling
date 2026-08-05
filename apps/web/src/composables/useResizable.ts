import { ref, type Ref } from 'vue'

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v))

export type ResizeAxis = 'x' | 'y'

export interface ResizableOptions {
  /** Drag axis: x drives widths, y drives heights. */
  axis?: ResizeAxis
  min?: number
  max?: number
  /**
   * Dragging toward the origin grows the value — for a handle on the LEFT edge
   * of a right-hand panel.
   */
  invert?: boolean
}

/**
 * The thing being resized: either a ref to write straight through, or a
 * get/set pair for values that live inside a keyed collection.
 */
export interface ResizeTarget {
  value?: Ref<number>
  get?: () => number
  set?: (v: number) => void
  onEnd?: () => void
}

/**
 * Generic pointer-drag resizing along one axis. One resizer instance can drive
 * many targets (e.g. every track row) — the target is bound per drag.
 *
 *   const sidebar = useResizable({ axis: 'x', min: 160, max: 480 })
 *   <ResizeHandle axis="x" @pointerdown="sidebar.start($event, { value: sidebarWidth })" />
 *
 *   const rows = useResizable({ axis: 'y', min: 32, max: 120 })
 *   rows.start(e, { get: () => heights[id], set: h => setHeight(id, h) })
 */
export function useResizable(
  { axis = 'x', min = 0, max = Infinity, invert = false }: ResizableOptions = {},
) {
  const resizing = ref(false)

  let startPos   = 0
  let startValue = 0
  let apply: ((v: number) => void) | null = null
  let finish: (() => void) | null = null

  function onMove(e: PointerEvent): void {
    const pos   = axis === 'x' ? e.clientX : e.clientY
    const delta = (pos - startPos) * (invert ? -1 : 1)
    apply?.(clamp(Math.round(startValue + delta), min, max))
  }

  function onUp(): void {
    resizing.value = false
    window.removeEventListener('pointermove', onMove)
    finish?.()
    apply  = null
    finish = null
  }

  /**
   * Begin a drag. Target is either a ref ({ value }) or a { get, set } pair;
   * optional onEnd fires once the pointer is released.
   */
  function start(e: PointerEvent, { value, get, set, onEnd }: ResizeTarget = {}): void {
    e.preventDefault()
    const getter = get ?? (() => value?.value ?? 0)
    apply        = set ?? ((v: number) => { if (value) value.value = v })
    finish       = onEnd ?? null
    startPos     = axis === 'x' ? e.clientX : e.clientY
    startValue   = getter()
    resizing.value = true
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }

  return { resizing, start }
}
