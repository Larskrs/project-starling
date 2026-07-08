<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FormDialog, FormField, Input } from '@starling/ui'
import { useApi } from '../../../composables/useApi.js'

// Compact clip dialog for metronome (ruler/BPM) tracks: a clip is just a
// position + tempo; the tempo applies until the next BPM clip.
const props = defineProps({
  open:            { type: Boolean, required: true },
  track:           { type: Object,  default: null },
  clip:            { type: Object,  default: null },   // null → create
  defaultPosition: { type: Number,  default: 0 },
})

const emit = defineEmits(['update:open', 'saved'])

const { t }      = useI18n()
const { $fetch } = useApi()

const position    = ref(0)
const bpm         = ref(120)
const beatsPerBar = ref(4)
const loading     = ref(false)
const error       = ref('')

const isEdit = computed(() => props.clip !== null)

watch(() => props.open, (open) => {
  if (!open) return
  error.value   = ''
  loading.value = false
  position.value    = props.clip?.position ?? props.defaultPosition
  bpm.value         = Number(props.clip?.data?.bpm) || 120
  beatsPerBar.value = Number(props.clip?.data?.beatsPerBar) || 4
})

const valid = computed(() => bpm.value >= 20 && bpm.value <= 400 && position.value >= 0)

async function submit() {
  if (!valid.value || !props.track) return
  loading.value = true
  error.value   = ''
  const tlId = props.track.timelineId
  const url  = isEdit.value ? `/api/timeline/${tlId}/clips/${props.clip.id}` : `/api/timeline/${tlId}/clips`
  const { ok, data, error: err } = await $fetch(url, {
    method: isEdit.value ? 'PATCH' : 'POST',
    json: {
      ...(isEdit.value ? {} : { trackId: props.track.id }),
      position: Math.round(position.value),
      label:    `${Math.round(bpm.value)} BPM`,
      data:     { bpm: Math.round(bpm.value), beatsPerBar: Math.round(beatsPerBar.value) || 4 },
    },
    silent: true,
  })
  loading.value = false
  if (!ok) { error.value = err ?? t('editor.failedToSaveClip'); return }
  emit('saved', data)
  emit('update:open', false)
}
</script>

<template>
  <FormDialog
    :open="open"
    :title="isEdit ? $t('editor.bpmClip.editTitle') : $t('editor.bpmClip.addTitle')"
    :submit-label="$t('editor.save')"
    :cancel-label="$t('editor.cancel')"
    :loading="loading"
    :disabled="!valid"
    :error="error"
    @update:open="$emit('update:open', $event)"
    @submit="submit"
  >
    <div class="flex gap-3">
      <FormField for="bpm-value" :label="$t('editor.bpmClip.bpm')" class="flex-1">
        <Input id="bpm-value" v-model.number="bpm" type="number" min="20" max="400" step="1" autofocus required />
      </FormField>
      <FormField for="bpm-beats" :label="$t('editor.bpmClip.beatsPerBar')" class="flex-1">
        <Input id="bpm-beats" v-model.number="beatsPerBar" type="number" min="1" max="12" step="1" />
      </FormField>
    </div>

    <FormField for="bpm-position" :label="$t('editor.clipPosition')">
      <Input id="bpm-position" v-model.number="position" type="number" min="0" step="1" />
    </FormField>
  </FormDialog>
</template>
