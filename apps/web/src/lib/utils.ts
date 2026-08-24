import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Join conditional class values, with later Tailwind utilities winning. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function greetingKey(): string {
  const h = new Date().getHours()
  if (h >= 18) return 'greeting.evening'
  if (h >= 12) return 'greeting.afternoon'
  if (h >= 6)  return 'greeting.morning'
  return 'greeting.night'
}

/** The `t` from useI18n, narrowed to the two call shapes this file uses. */
type Translate = (key: string, named?: Record<string, unknown>) => string

/**
 * "3 minutes ago" for an ISO timestamp, using the caller's `t` from useI18n.
 * Falls back to an empty string for a missing/unparseable date.
 */
export function relativeTime(t: Translate, iso: string | null | undefined): string {
  const ms = new Date(iso ?? '').getTime()
  if (!iso || Number.isNaN(ms)) return ''

  const mins  = Math.floor((Date.now() - ms) / 60000)
  const hours = Math.floor(mins / 60)
  const days  = Math.floor(hours / 24)
  if (mins  < 1)   return t('time.justNow')
  if (mins  < 60)  return t('time.minutesAgo', { n: mins })
  if (hours < 24)  return t('time.hoursAgo',   { n: hours })
  if (days  < 7)   return t('time.daysAgo',    { n: days })
  if (days  < 30)  return t('time.weeksAgo',   { n: Math.floor(days / 7) })
  if (days  < 365) return t('time.monthsAgo',  { n: Math.floor(days / 30) })
  return t('time.yearsAgo', { n: Math.floor(days / 365) })
}

/** The frame span fields every timeline-length helper needs. */
export interface TimelineSpan {
  startFrame: number
  endFrame: number
  frameRate: string | number
}

/** How many frames a timeline covers. Never negative. */
export function timelineFrames(tl: TimelineSpan): number {
  return Math.max(0, tl.endFrame - tl.startFrame)
}

/**
 * A timeline's length as HH:MM:SS:FF. Drop-frame rates are shown at their
 * nearest whole fps, which is what the editor's ruler does — this is a duration
 * at a glance, not a timecode you can conform against.
 */
export function timelineDuration(tl: TimelineSpan): string {
  const fps    = Math.round(parseFloat(String(tl.frameRate))) || 25
  const frames = timelineFrames(tl)
  const pad    = (n: number) => String(n).padStart(2, '0')
  return [
    pad(Math.floor(frames / (fps * 3600))),
    pad(Math.floor(frames / (fps * 60)) % 60),
    pad(Math.floor(frames / fps) % 60),
    pad(frames % fps),
  ].join(':')
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes)            return '0 B'
  if (bytes < 1024)      return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
