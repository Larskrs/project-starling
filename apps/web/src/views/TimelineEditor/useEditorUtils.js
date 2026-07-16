// Converts an absolute frame number to a HH:MM:SS:FF timecode string.
export function framesToTC(frame, frameRate) {
  const fps  = parseFloat(frameRate)
  const abs  = Math.abs(Math.round(frame))
  const ff   = abs % Math.round(fps)
  const secs = Math.floor(abs / fps)
  const ss   = secs % 60
  const mm   = Math.floor(secs / 60) % 60
  const hh   = Math.floor(secs / 3600)
  const sign = frame < 0 ? '-' : ''
  const pad  = n => String(n).padStart(2, '0')
  return `${sign}${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`
}

// Nice ruler interval in frames for a target pixel density. Sub-second ticks
// use frame counts; anything longer snaps to time-nice steps (1s … 2h) so the
// timecode labels land on round times.
const NICE_FRAMES  = [1, 2, 5, 10]
const NICE_SECONDS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200]

/** Target px between ruler ticks — also anchors the editor's default zoom
 *  (pxPerFrame is chosen so one tick ≈ 5 minutes). */
export const RULER_TICK_TARGET_PX = 80

export function rulerInterval(pxPerFrame, fps = 25, targetPx = RULER_TICK_TARGET_PX) {
  const framesPerTarget = targetPx / pxPerFrame
  const frameStep = NICE_FRAMES.find(n => n >= framesPerTarget)
  if (frameStep && frameStep < fps) return frameStep
  const secStep = NICE_SECONDS.find(s => s * fps >= framesPerTarget) ?? NICE_SECONDS[NICE_SECONDS.length - 1]
  return Math.max(1, Math.round(secStep * fps))
}

// Clamp a value between min and max.
export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val))
}

// Clip display width in px (clip mode).
export function clipWidth(clip, pxPerFrame) {
  if (clip.mediaStart == null || clip.end == null) return Math.max(2, pxPerFrame)
  return Math.max(2, (clip.end - clip.mediaStart) * pxPerFrame)
}

// Clip x offset in px from the timeline start.
export function clipLeft(clip, startFrame, pxPerFrame) {
  return (clip.position - startFrame) * pxPerFrame
}
