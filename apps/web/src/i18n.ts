import { createI18n } from 'vue-i18n'
import en from './locales/en.json'
import no from './locales/no.json'

const saved = localStorage.getItem('starling-locale')

function detectBrowserLocale() {
  for (const lang of (navigator.languages ?? [navigator.language])) {
    if (lang.startsWith('nb') || lang.startsWith('no') || lang.startsWith('nn')) return 'no'
    if (lang.startsWith('en')) return 'en'
  }
  return 'en'
}

const browser = detectBrowserLocale()

export default createI18n({
  legacy: false,
  locale: saved ?? browser,
  fallbackLocale: 'en',
  messages: { en, no },
})
