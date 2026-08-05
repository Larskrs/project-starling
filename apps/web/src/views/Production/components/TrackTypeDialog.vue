<script setup>
import { ref, computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import {
  IconPicker, Input, SelectMenu, SettingsDialog, SettingsPage, SettingsRow, Switch, SwitchTab,
} from '@starling/ui'
import HuePicker from './HuePicker.vue'
import { useEntityDialog } from '../../../composables/useEntityDialog'
import { useIconPicker } from '../../../composables/useIconPicker'

const props = defineProps({
  open:       { type: Boolean, required: true },
  trackType:  { type: Object,  default: null },
  sourceSets: { type: Array,   default: () => [] },
})

const emit = defineEmits(['update:open', 'created', 'updated'])

const data = inject('production-data')
const { t } = useI18n()
const iconPicker = useIconPicker()

const name        = ref('')
const hue         = ref(250)
const icon        = ref(null)
const mode        = ref('clip')
const sourceSetId = ref(null)

// Behavior settings (dedicated columns on trackTypes)
const trackDisplay = ref('normal')
const nameDisplay  = ref('normal')
const clipDisplay  = ref('normal')
const metronome    = ref(false)
const tts          = ref(false)

const modeOptions = computed(() => [
  { value: 'clip',  label: t('trackTypes.modeClip') },
  { value: 'event', label: t('trackTypes.modeEvent') },
])
const sourceSetOptions = computed(() =>
  props.sourceSets.map(s => ({ value: s.id, label: s.name, icon: s.icon || 'mdi:layers-outline' }))
)
const trackDisplayOptions = computed(() => [
  { value: 'normal', label: t('trackTypes.settings.displayNormal') },
  { value: 'ruler',  label: t('trackTypes.settings.displayRuler') },
])
const nameDisplayOptions = computed(() => [
  { value: 'normal',    label: t('trackTypes.settings.nameNormal') },
  { value: 'stretch',   label: t('trackTypes.settings.nameStretch') },
  { value: 'emphasize', label: t('trackTypes.settings.nameEmphasize') },
])
const clipDisplayOptions = computed(() => [
  { value: 'normal',      label: t('trackTypes.settings.clipNormal') },
  { value: 'zebra',       label: t('trackTypes.settings.clipZebra') },
  { value: 'border',      label: t('trackTypes.settings.clipBorder') },
  { value: 'transparent', label: t('trackTypes.settings.clipTransparent') },
])

// `invalid` marks the page holding the field that blocks submitting, so the
// disabled save button is explained even from another page.
const pages = computed(() => [
  { id: 'general',    label: t('trackTypes.pages.general'),    icon: 'mdi:tune',                invalid: !name.value.trim() },
  { id: 'appearance', label: t('trackTypes.pages.appearance'), icon: 'mdi:palette-outline' },
  { id: 'behavior',   label: t('trackTypes.pages.behavior'),   icon: 'mdi:play-circle-outline' },
])

const { isEdit, loading, error, submit } = useEntityDialog({
  open:   () => props.open,
  entity: () => props.trackType,
  emit,
  url: () => `/api/production/${data.value?.production?.id}/track-types`,
  fill: (tt) => {
    name.value        = tt.name
    hue.value         = tt.hue ?? 250
    icon.value        = tt.icon ?? null
    mode.value        = tt.trackMode
    sourceSetId.value = tt.sourceSetId ?? null
    trackDisplay.value = tt.trackDisplay ?? 'normal'
    nameDisplay.value  = tt.nameDisplay ?? 'normal'
    clipDisplay.value  = tt.clipDisplay ?? 'normal'
    metronome.value    = tt.metronome ?? false
    tts.value          = tt.tts ?? false
  },
  reset: () => {
    name.value = ''; hue.value = 250; icon.value = null; mode.value = 'clip'; sourceSetId.value = null
    trackDisplay.value = 'normal'; nameDisplay.value = 'normal'; clipDisplay.value = 'normal'
    metronome.value = false; tts.value = false
  },
  payload: () => ({
    name:         name.value.trim(),
    hue:          hue.value,
    icon:         icon.value,
    trackMode:    mode.value,
    sourceSetId:  sourceSetId.value,
    trackDisplay: trackDisplay.value,
    nameDisplay:  nameDisplay.value,
    clipDisplay:  clipDisplay.value,
    metronome:    metronome.value,
    tts:          tts.value,
  }),
  validate:      () => !!name.value.trim(),
  failedMessage: () => t('trackTypes.failedToSave'),
})
</script>

<template>
  <SettingsDialog
    :open="open"
    :title="isEdit ? $t('trackTypes.editDialog.title') : $t('trackTypes.addDialog.title')"
    :pages="pages"
    :submit-label="isEdit ? $t('trackTypes.save') : $t('trackTypes.create')"
    :cancel-label="$t('trackTypes.cancel')"
    :loading="loading"
    :disabled="!name.trim()"
    :error="error"
    @update:open="$emit('update:open', $event)"
    @submit="submit"
  >
    <SettingsPage id="general">
      <SettingsRow for="tt-name" :label="$t('trackTypes.name')">
        <Input id="tt-name" v-model="name" :placeholder="$t('trackTypes.namePlaceholder')" maxlength="64" autofocus required />
      </SettingsRow>

      <SettingsRow :label="$t('trackTypes.color')">
        <HuePicker v-model="hue" class="w-full" />
      </SettingsRow>

      <SettingsRow :label="$t('trackTypes.icon')">
        <IconPicker v-model="icon" v-bind="iconPicker" :hue="hue" allow-none />
      </SettingsRow>

      <SettingsRow :label="$t('trackTypes.mode')">
        <SwitchTab v-model="mode" :options="modeOptions" />
      </SettingsRow>

      <SettingsRow :label="$t('trackTypes.sourceSet')">
        <SelectMenu
          v-model="sourceSetId"
          :options="sourceSetOptions"
          :null-label="$t('trackTypes.noSourceSet')"
        >
          <template #selected="{ option }">
            <Icon v-if="option?.icon" :icon="option.icon" class="size-4 shrink-0 text-muted-foreground" />
          </template>
          <template #icon="{ option }">
            <Icon v-if="option?.icon" :icon="option.icon" class="size-4 text-muted-foreground" />
          </template>
        </SelectMenu>
      </SettingsRow>
    </SettingsPage>

    <SettingsPage id="appearance">
      <!-- Metronome fixes the display, so the row states the effective value
           and says why rather than offering a control that does nothing. -->
      <SettingsRow
        :label="$t('trackTypes.settings.trackDisplay')"
        :description="metronome ? $t('trackTypes.settings.metronomeOverridesDisplay') : ''"
      >
        <SwitchTab v-if="!metronome" v-model="trackDisplay" :options="trackDisplayOptions" />
        <span v-else class="text-sm text-muted-foreground">
          {{ $t('trackTypes.settings.displayRuler') }}
        </span>
      </SettingsRow>

      <SettingsRow :label="$t('trackTypes.settings.nameDisplay')">
        <SelectMenu v-model="nameDisplay" :options="nameDisplayOptions" />
      </SettingsRow>

      <SettingsRow :label="$t('trackTypes.settings.clipDisplay')">
        <SelectMenu v-model="clipDisplay" :options="clipDisplayOptions" />
      </SettingsRow>
    </SettingsPage>

    <SettingsPage id="behavior">
      <SettingsRow :label="$t('trackTypes.settings.metronome')">
        <Switch v-model="metronome" />
      </SettingsRow>

      <SettingsRow :label="$t('trackTypes.settings.tts')">
        <Switch v-model="tts" />
      </SettingsRow>
    </SettingsPage>

  </SettingsDialog>
</template>
