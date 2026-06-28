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

export function formatBytes(bytes) {
  if (!bytes)            return '0 B'
  if (bytes < 1024)      return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}