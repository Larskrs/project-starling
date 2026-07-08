<script setup>
import { ref, computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { FormDialog, FormField, Input, SelectMenu, SwitchTab } from '@starling/ui'
import HuePicker from './HuePicker.vue'
import { useEntityDialog } from '../../../composables/useEntityDialog.js'

const props = defineProps({
  open:       { type: Boolean, required: true },
  trackType:  { type: Object,  default: null },
  sourceSets: { type: Array,   default: () => [] },
})

const emit = defineEmits(['update:open', 'created', 'updated'])

const data = inject('production-data')
const { t } = useI18n()

const name        = ref('')
const hue         = ref(250)
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
  props.sourceSets.map(s => ({ value: s.id, label: s.name }))
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

const { isEdit, loading, error, submit } = useEntityDialog({
  open:   () => props.open,
  entity: () => props.trackType,
  emit,
  url: () => `/api/production/${data.value?.production?.id}/track-types`,
  fill: (tt) => {
    name.value        = tt.name
    hue.value         = tt.hue ?? 250
    mode.value        = tt.trackMode
    sourceSetId.value = tt.sourceSetId ?? null
    trackDisplay.value = tt.trackDisplay ?? 'normal'
    nameDisplay.value  = tt.nameDisplay ?? 'normal'
    clipDisplay.value  = tt.clipDisplay ?? 'normal'
    metronome.value    = tt.metronome ?? false
    tts.value          = tt.tts ?? false
  },
  reset: () => {
    name.value = ''; hue.value = 250; mode.value = 'clip'; sourceSetId.value = null
    trackDisplay.value = 'normal'; nameDisplay.value = 'normal'; clipDisplay.value = 'normal'
    metronome.value = false; tts.value = false
  },
  payload: () => ({
    name:         name.value.trim(),
    hue:          hue.value,
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
  <FormDialog
    :open="open"
    :title="isEdit ? $t('trackTypes.editDialog.title') : $t('trackTypes.addDialog.title')"
    :submit-label="isEdit ? $t('trackTypes.save') : $t('trackTypes.create')"
    :cancel-label="$t('trackTypes.cancel')"
    :loading="loading"
    :disabled="!name.trim()"
    :error="error"
    @update:open="$emit('update:open', $event)"
    @submit="submit"
  >
    <FormField for="tt-name" :label="$t('trackTypes.name')">
      <Input id="tt-name" v-model="name" :placeholder="$t('trackTypes.namePlaceholder')" maxlength="64" autofocus required />
    </FormField>

    <FormField :label="$t('trackTypes.color')">
      <HuePicker v-model="hue" />
    </FormField>

    <FormField :label="$t('trackTypes.mode')">
      <SwitchTab v-model="mode" :options="modeOptions" />
    </FormField>

    <FormField :label="$t('trackTypes.sourceSet')">
      <SelectMenu
        v-model="sourceSetId"
        :options="sourceSetOptions"
        :null-label="$t('trackTypes.noSourceSet')"
      >
        <template #icon="{ option }">
          <Icon v-if="option" icon="mdi:layers-outline" class="size-4 text-muted-foreground" />
        </template>
      </SelectMenu>
    </FormField>

    <!-- Editor behaviors -->
    <div class="border-t border-border pt-3 mt-1 flex flex-col gap-3">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {{ $t('trackTypes.settings.title') }}
      </p>

      <FormField :label="$t('trackTypes.settings.trackDisplay')">
        <SwitchTab v-model="trackDisplay" :options="trackDisplayOptions" />
      </FormField>

      <FormField :label="$t('trackTypes.settings.nameDisplay')">
        <SwitchTab v-model="nameDisplay" :options="nameDisplayOptions" />
      </FormField>

      <FormField :label="$t('trackTypes.settings.clipDisplay')">
        <SwitchTab v-model="clipDisplay" :options="clipDisplayOptions" />
      </FormField>

      <label class="flex items-center gap-2 cursor-pointer select-none">
        <input v-model="metronome" type="checkbox" class="accent-primary size-4" />
        <span class="text-sm text-foreground">{{ $t('trackTypes.settings.metronome') }}</span>
      </label>

      <label class="flex items-center gap-2 cursor-pointer select-none">
        <input v-model="tts" type="checkbox" class="accent-primary size-4" />
        <span class="text-sm text-foreground">{{ $t('trackTypes.settings.tts') }}</span>
      </label>
    </div>
  </FormDialog>
</template>
