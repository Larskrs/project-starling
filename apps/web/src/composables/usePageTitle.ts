import { watchEffect, toValue, type MaybeRefOrGetter } from 'vue'

const APP = 'Cino.no'

export function usePageTitle(title: MaybeRefOrGetter<string | null | undefined>): void {
  watchEffect(() => {
    const t = toValue(title)
    document.title = t ? `${t} — ${APP}` : APP
  })
}
