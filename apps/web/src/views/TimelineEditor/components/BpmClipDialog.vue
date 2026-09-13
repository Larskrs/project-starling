<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button, FormDialog, FormField, Input } from '@starling/ui'
import TimecodeInput from './TimecodeInput.vue'
import { useApi } from '../../../composables/useApi'
import type { EditorClip, EditorTrack } from '../../../types/timeline'

// Compact clip dialog for metronome (ruler/BPM) tracks: a clip is just a
// position + tempo; the tempo applies until the next BPM clip.
const props = withDefaults(defineProps<{
  open: boolean
  track?: EditorTrack | null
  /** null → create. */
  clip?: EditorClip | null
  defaultPosition?: number
  frameRate?: string | number
  /** Where the playhead is, for the "use playhead" shortcut. */
  playheadFrame?: number
}>(), { track: null, clip: null, defaultPosition: 0, frameRate: 25, playheadFrame: 0 })

const emit = defineEmits<{
  'update:open': [open: boolean]
  saved: [clip: EditorClip]
}>()

const { t }      = useI18n()
const { $fetch } = useApi()

const position      = ref(0)
const positionValid = ref(true)
const bpm           = ref(120)
const beatsPerBar   = ref(4)
const loading       = ref(false)
const error         = ref('')

const isEdit = computed(() => props.clip !== null)

watch(() => props.open, (open) => {
  if (!open) return
  error.value   = ''
  loading.value = false
  positionValid.value = true
  position.value    = props.clip?.position ?? props.defaultPosition
  bpm.value         = Number(props.clip?.data?.bpm) || 120
  beatsPerBar.value = Number(props.clip?.data?.beatsPerBar) || 4
})

const valid = computed(() =>
  bpm.value >= 20 && bpm.value <= 400 && position.value >= 0 && positionValid.value)

function usePlayhead() {
  position.value = Math.max(0, Math.round(props.playheadFrame))
  positionValid.value = true
}

async function submit() {
  if (!valid.value || !props.track) return
  loading.value = true
  error.value   = ''
  const tlId = props.track.timelineId
  const url  = props.clip ? `/api/timeline/${tlId}/clips/${props.clip.id}` : `/api/timeline/${tlId}/clips`
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
      <div class="flex items-center gap-2">
        <div class="flex-1 min-w-0">
          <TimecodeInput
            id="bpm-position"
            v-model="position"
            :frame-rate="frameRate"
            @validity="positionValid = $event"
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          class="shrink-0 text-muted-foreground"
          :title="$t('editor.usePlayheadHint')"
          @click="usePlayhead"
        >
          <Icon icon="mdi:ray-vertex" class="size-4" />
          {{ $t('editor.usePlayhead') }}
        </Button>
      </div>
      <p v-if="!positionValid" class="mt-1 text-xs text-destructive">{{ $t('editor.invalidTimecode') }}</p>
    </FormField>
  </FormDialog>
</template>
