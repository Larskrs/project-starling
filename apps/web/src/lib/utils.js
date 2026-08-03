import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function greetingKey() {
  const h = new Date().getHours()
  if (h >= 18) return 'greeting.evening'
  if (h >= 12) return 'greeting.afternoon'
  if (h >= 6)  return 'greeting.morning'
  return 'greeting.night'
}

/**
 * "3 minutes ago" for an ISO timestamp, using the caller's `t` from useI18n.
 * Falls back to an empty string for a missing/unparseable date.
 */
export function relativeTime(t, iso) {
  const ms = new Date(iso).getTime()
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

export function formatBytes(bytes) {
  if (!bytes)            return '0 B'
  if (bytes < 1024)      return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}