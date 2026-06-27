import { useI18n } from 'vue-i18n'

const LOCALES = ['en', 'no']

export function useLocale() {
  const { locale } = useI18n()

  function setLocale(lang) {
    locale.value = lang
    localStorage.setItem('starling-locale', lang)
  }

  function toggleLocale() {
    const next = LOCALES[(LOCALES.indexOf(locale.value) + 1) % LOCALES.length]
    setLocale(next)
  }

  return { locale, setLocale, toggleLocale }
}
