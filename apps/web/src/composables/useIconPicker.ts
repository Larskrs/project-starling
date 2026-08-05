import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ICON_GROUPS } from '@starling/ui/icons'

/**
 * Translated labels for the `IconPicker` in @starling/ui — that package carries
 * no i18n of its own, so the strings come in as props. Spread the result:
 *
 *   <IconPicker v-model="icon" v-bind="iconPicker" allow-none :none-label="…" />
 */
export function useIconPicker() {
  const { t } = useI18n()

  return computed(() => ({
    title:             t('icons.pick'),
    placeholder:       t('icons.pick'),
    searchPlaceholder: t('icons.search'),
    emptyLabel:        t('icons.empty'),
    noneLabel:         t('icons.none'),
    groupLabels:       Object.fromEntries(
      ICON_GROUPS.map(g => [g.id, t(`icons.groups.${g.id}`)]),
    ),
  }))
}
