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