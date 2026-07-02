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

// Nice ruler interval in frames given a target pixel density.
const NICE = [1, 2, 5, 10, 25, 50, 100, 200, 250, 500, 1000, 2500, 5000, 10000]

export function rulerInterval(pxPerFrame, targetPx = 80) {
  const framesPerTarget = targetPx / pxPerFrame
  return NICE.find(n => n >= framesPerTarget) ?? NICE[NICE.length - 1]
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
