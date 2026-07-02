<script setup>
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { FormDialog, FormField, Input, SelectMenu } from '@starling/ui'
import { useEntityDialog } from '../../../composables/useEntityDialog.js'

const FRAME_RATES = ['23.976', '24', '25', '29.97', '29.97df', '30', '50', '59.94', '60']

const props = defineProps({
  open:     { type: Boolean, required: true },
  timeline: { type: Object,  default: null },
})

const emit = defineEmits(['update:open', 'created', 'updated'])

const route = useRoute()
const { t } = useI18n()

const name            = ref('')
const frameRate       = ref('25')
const startFrame      = ref(0)
const endFrame        = ref(86400)
const ltcOffsetFrames = ref(0)

const frameRateOptions = FRAME_RATES.map(r => ({ value: r, label: `${r} fps` }))

const endFrameError = computed(() =>
  endFrame.value <= startFrame.value ? t('timelines.endFrameMustBeAfterStart') : ''
)

const { isEdit, loading, error, submit } = useEntityDialog({
  open:   () => props.open,
  entity: () => props.timeline,
  emit,
  url: () => `/api/company/${route.params.cslug}/production/${route.params.pslug}/timelines`,
  fill: (tl) => {
    name.value            = tl.name
    frameRate.value       = tl.frameRate
    startFrame.value      = tl.startFrame
    endFrame.value        = tl.endFrame
    ltcOffsetFrames.value = tl.ltcOffsetFrames
  },
  reset: () => {
    name.value = ''; frameRate.value = '25'; startFrame.value = 0; endFrame.value = 86400; ltcOffsetFrames.value = 0
  },
  payload: () => ({
    name:            name.value.trim(),
    frameRate:       frameRate.value,
    startFrame:      Number(startFrame.value),
    endFrame:        Number(endFrame.value),
    ltcOffsetFrames: Number(ltcOffsetFrames.value),
  }),
  validate:      () => !!name.value.trim() && !endFrameError.value,
  failedMessage: () => t('timelines.failedToSave'),
})
</script>

<template>
  <FormDialog
    :open="open"
    :title="isEdit ? $t('timelines.editDialog.title') : $t('timelines.addDialog.title')"
    :submit-label="isEdit ? $t('timelines.save') : $t('timelines.create')"
    :cancel-label="$t('timelines.cancel')"
    :loading="loading"
    :disabled="!name.trim() || !!endFrameError"
    :error="error"
    @update:open="$emit('update:open', $event)"
    @submit="submit"
  >
    <FormField for="tl-name" :label="$t('timelines.name')">
      <Input id="tl-name" v-model="name" :placeholder="$t('timelines.namePlaceholder')" maxlength="128" autofocus required />
    </FormField>

    <FormField :label="$t('timelines.frameRate')">
      <SelectMenu v-model="frameRate" :options="frameRateOptions" />
    </FormField>

    <div class="flex gap-3">
      <FormField for="tl-start" :label="$t('timelines.startFrame')" class="flex-1">
        <Input id="tl-start" v-model.number="startFrame" type="number" min="0" step="1" />
      </FormField>
      <FormField for="tl-end" :label="$t('timelines.endFrame')" class="flex-1">
        <Input
          id="tl-end"
          v-model.number="endFrame"
          type="number"
          min="1"
          step="1"
          :class="endFrameError ? 'border-destructive' : ''"
        />
      </FormField>
    </div>
    <p v-if="endFrameError" class="text-xs text-destructive -mt-1">{{ endFrameError }}</p>

    <FormField for="tl-ltc" :label="$t('timelines.ltcOffset')">
      <Input id="tl-ltc" v-model.number="ltcOffsetFrames" type="number" step="1" />
    </FormField>
  </FormDialog>
</template>
