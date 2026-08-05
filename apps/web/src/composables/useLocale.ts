import { useI18n } from 'vue-i18n'

export type Locale = 'en' | 'no'

const LOCALES: Locale[] = ['en', 'no']

export function useLocale() {
  const { locale } = useI18n()

  function setLocale(lang: Locale): void {
    locale.value = lang
    localStorage.setItem('starling-locale', lang)
  }

  function toggleLocale(): void {
    const at = LOCALES.indexOf(locale.value as Locale)
    setLocale(LOCALES[(at + 1) % LOCALES.length])
  }

  return { locale, setLocale, toggleLocale }
}
