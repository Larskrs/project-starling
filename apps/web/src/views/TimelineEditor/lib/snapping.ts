/**
 * Magnetic snapping for clip edits (move, trim, chip drags).
 *
 * The editor collects a sorted list of frames worth landing on — the playhead,
 * the timeline bounds, every other clip's edges — once when a drag starts, and
 * each pointer move asks for the nearest one within a pixel radius. The radius
 * is in SCREEN pixels converted to frames, so the pull feels the same at every
 * zoom level instead of becoming a chasm when zoomed out.
 */

/** How close (in px) an edge has to come to a target before it snaps. */
export const SNAP_PX = 8

/** Sorted, de-duplicated, whole-frame target list. */
export function buildSnapTargets(frames: Iterable<number>): number[] {
  const unique = new Set<number>()
  for (const f of frames) if (Number.isFinite(f)) unique.add(Math.round(f))
  return [...unique].sort((a, b) => a - b)
}

/** The target nearest `frame`, if one lies within `threshold` frames; else null. */
export function nearestTarget(targets: readonly number[], frame: number, threshold: number): number | null {
  if (targets.length === 0) return null
  // First index whose target is >= frame; the nearest is it or its predecessor.
  let lo = 0, hi = targets.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (targets[mid]! < frame) lo = mid + 1
    else hi = mid
  }
  let best: number | null = null
  let bestD = Infinity
  for (const i of [lo - 1, lo]) {
    const t = targets[i]
    if (t === undefined) continue
    const d = Math.abs(t - frame)
    if (d < bestD) { best = t; bestD = d }
  }
  return bestD <= threshold ? best : null
}

export interface SnappedSpan {
  /** Resolved whole-frame start. */
  start: number
  /** The target that caught — where to draw the guide — or null. */
  guide: number | null
}

/**
 * Snaps a span being moved. Either edge may catch a target; the closer catch
 * wins, so a clip slides into place against its neighbour from either side.
 * `length` 0 means a point (event clips, markers): only the start snaps.
 */
export function snapSpan(targets: readonly number[], start: number, length: number, threshold: number): SnappedSpan {
  const a = nearestTarget(targets, start, threshold)
  const b = length > 0 ? nearestTarget(targets, start + length, threshold) : null
  const da = a === null ? Infinity : Math.abs(a - start)
  const db = b === null ? Infinity : Math.abs(b - (start + length))
  if (da === Infinity && db === Infinity) return { start: Math.round(start), guide: null }
  return da <= db ? { start: a!, guide: a } : { start: b! - length, guide: b }
}
