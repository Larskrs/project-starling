import { watchEffect, toValue } from 'vue'

const APP = 'Cino.no'

export function usePageTitle(title) {
  watchEffect(() => {
    const t = toValue(title)
    document.title = t ? `${t} — ${APP}` : APP
  })
}
