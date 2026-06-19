import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function helloOfDay() {
  const now = new Date().getHours();

  const hellos = new Map([
    [24, "God natt"],
    [18, "God kveld"],
    [12, "God ettermiddag"],
    [9, "God dag"],
    [6, "God morgen"],
    [0, "God natt"]
  ]);

  for (const [hour, greeting] of hellos) {
    if (now >= hour) {
      return greeting;
    }
  }
}