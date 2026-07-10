import { fileURLToPath } from 'url'
import { resolve }       from 'path'
import starlingPreset    from '@starling/ui/tailwind-preset'

const dir   = fileURLToPath(new URL('.', import.meta.url))
const uiSrc = resolve(dir, '../../packages/ui/src')

/** @type {import('tailwindcss').Config} */
export default {
  presets: [starlingPreset],
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
    `${uiSrc}/**/*.{vue,js,ts,jsx,tsx}`,
  ],
}
