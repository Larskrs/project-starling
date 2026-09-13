import type { Clip } from '../../../types/timeline'

// Converts an absolute frame number to a HH:MM:SS:FF timecode string.
export function framesToTC(frame: number, frameRate: string | number): string {
  const fps  = typeof frameRate === 'number' ? frameRate : parseFloat(frameRate)
  const abs  = Math.abs(Math.round(frame))
  const ff   = abs % Math.round(fps)
  const secs = Math.floor(abs / fps)
  const ss   = secs % 60
  const mm   = Math.floor(secs / 60) % 60
  const hh   = Math.floor(secs / 3600)
  const sign = frame < 0 ? '-' : ''
  const pad  = (n: number) => String(n).padStart(2, '0')
  return `${sign}${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`
}

/**
 * Parses what someone types into a timecode field, or null if it is neither
 * form below.
 *
 * - "HH:MM:SS:FF", or any shorter right-aligned form ("SS:FF", "MM:SS:FF").
 *   `;` and `.` work as separators too (drop-frame notation, numpad typing).
 *   The leading part may overflow ("90:00" is ninety seconds); the rest must
 *   be in range, so a typo like "00:75:00:00" is rejected rather than guessed.
 * - A bare whole number is a frame count, which is what these fields held
 *   before they spoke timecode.
 */
export function tcToFrames(text: string, frameRate: string | number): number | null {
  const fps = typeof frameRate === 'number' ? frameRate : parseFloat(frameRate)
  const s   = text.trim()
  if (!s || !(fps > 0)) return null
  if (/^\d+$/.test(s)) return Number(s)
  if (!/^\d+(?:[:;.]\d+){1,3}$/.test(s)) return null

  const parts = s.split(/[:;.]/).map(Number).reverse()   // FF, SS, MM, HH
  const limits = [Math.round(fps), 60, 60]
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i]! >= limits[i]!) return null
  }
  const [ff = 0, ss = 0, mm = 0, hh = 0] = parts
  return Math.round((hh * 3600 + mm * 60 + ss) * fps) + ff
}

// Nice ruler interval in frames for a target pixel density. Sub-second ticks
// use frame counts; anything longer snaps to time-nice steps (1s … 2h) so the
// timecode labels land on round times.
const NICE_FRAMES: number[]  = [1, 2, 5, 10]
const NICE_SECONDS: number[] = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200]

/** Target px between ruler ticks — also anchors the editor's default zoom
 *  (pxPerFrame is chosen so one tick ≈ 5 minutes). */
export const RULER_TICK_TARGET_PX = 80

export function rulerInterval(pxPerFrame: number, fps = 25, targetPx = RULER_TICK_TARGET_PX): number {
  const framesPerTarget = targetPx / pxPerFrame
  const frameStep = NICE_FRAMES.find(n => n >= framesPerTarget)
  if (frameStep && frameStep < fps) return frameStep
  const secStep = NICE_SECONDS.find(s => s * fps >= framesPerTarget) ?? NICE_SECONDS[NICE_SECONDS.length - 1]
  return Math.max(1, Math.round(secStep * fps))
}

// Clamp a value between min and max.
export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

// Clip display width in px (clip mode).
export function clipWidth(clip: Pick<Clip, 'mediaStart' | 'end'>, pxPerFrame: number): number {
  if (clip.mediaStart == null || clip.end == null) return Math.max(2, pxPerFrame)
  return Math.max(2, (clip.end - clip.mediaStart) * pxPerFrame)
}

// Clip x offset in px from the timeline start.
export function clipLeft(clip: Pick<Clip, 'position'>, startFrame: number, pxPerFrame: number): number {
  return (clip.position - startFrame) * pxPerFrame
}

// ── Source switcher hotkeys ───────────────────────────────────────────────────
// The first ten sources of the selected track are bound to the digit keys, in
// reading order: 1…9 then 0 for the tenth. Shared by the key handler and the
// switcher's keycaps so the labels can never disagree with what the keys do.
export const SOURCE_HOTKEYS: string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']

/**
 * Source index a keydown selects, or -1 for anything else.
 *
 * Matches on `event.code`, so the number row and the numpad both work and the
 * binding follows the PHYSICAL key — a layout where the digit needs Shift (or
 * one that isn't QWERTY at all) still triggers off the key labelled "3".
 */
export function sourceIndexFromKey(event: KeyboardEvent): number {
  const match = /^(?:Digit|Numpad)(\d)$/.exec(event.code)
  if (!match) return -1
  const digit = Number(match[1])
  return digit === 0 ? SOURCE_HOTKEYS.length - 1 : digit - 1
}
