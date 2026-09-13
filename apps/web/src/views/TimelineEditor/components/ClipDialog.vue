<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button, FormField, Input, SplitDialog } from '@starling/ui'
import HuePicker from '../../Production/components/HuePicker.vue'
import TimecodeInput from './TimecodeInput.vue'
import { SelectFileDialog } from '../../../components/storage'
import { useApi } from '../../../composables/useApi'
import { framesToTC } from '../lib/editorUtils'
import type { Timeline } from '../../../types/api'
import type { EditorClip, EditorTrack, Source } from '../../../types/timeline'
import type { StorageFile } from '../../../types/storage'

// track/clip/timeline are null while the dialog is closed; `clip: null` also
// means "create" rather than "edit" when it is open.
const props = withDefaults(defineProps<{
  open: boolean
  track?: EditorTrack | null
  clip?: EditorClip | null
  trackSources?: Source[]
  defaultPosition?: number
  timeline?: Timeline | null
  /** Where the playhead is, for the "use playhead" shortcut. */
  playheadFrame?: number
}>(), {
  track: null, clip: null, trackSources: () => [], defaultPosition: 0, timeline: null, playheadFrame: 0,
})

const emit = defineEmits<{
  'update:open': [open: boolean]
  saved: [clip: EditorClip]
}>()

const { t }      = useI18n()
const { $fetch } = useApi()

const label      = ref('')
const position   = ref(0)
const mediaStart = ref(0)
const mediaEnd   = ref(100)
const sourceId   = ref<string | null>(null)
const fileId     = ref<string | null>(null)
const hue        = ref<number | null>(null)   // null = inherit the track type's hue
const loading    = ref(false)
const error      = ref('')

const fps = computed(() => props.timeline?.frameRate ?? 25)

// Each timecode field reports whether its text parses; any bad one blocks save.
const tcValid   = ref({ position: true, mediaStart: true, mediaEnd: true })
const tcInvalid = computed(() => !Object.values(tcValid.value).every(Boolean))

// HuePicker needs a number; null shows the neutral default until the user drags.
const hueProxy = computed({
  get: () => hue.value ?? 250,
  set: (v) => { hue.value = v },
})

// A clip renders either the audio or the image behind its fileId, so both are
// offered. The picked file is browsed for in SelectFileDialog; `pickedFile`
// only holds enough to label the button. On edit the clip arrives with a
// fileId and no name, so the name is looked up once.
const CLIP_FILE_TYPES = ['audio', 'image']

const pickedFile   = ref<StorageFile | null>(null)
const filePickerOpen = ref(false)

const isEdit      = computed(() => props.clip !== null)
const isEventMode = computed(() => props.track?.mode === 'event')
// Source grid only applies to event-mode tracks with sources.
const hasSources  = computed(() => isEventMode.value && props.trackSources.length > 0)

// The right column holds whatever is specific to this track's kind: its
// sources, or its audio. An event track with no source set has neither, and
// the dialog narrows to the general fields alone.
const hasDetail = computed(() => hasSources.value || !isEventMode.value)

const endFrameError = computed(() =>
  !isEventMode.value && !fileId.value && mediaEnd.value <= mediaStart.value
    ? t('editor.endMustBeAfterStart')
    : '',
)

const durationTC = computed(() => framesToTC(Math.max(0, mediaEnd.value - mediaStart.value), fps.value))

watch(() => props.open, async (open) => {
  if (!open) return
  error.value   = ''
  loading.value = false
  tcValid.value = { position: true, mediaStart: true, mediaEnd: true }

  const editing = props.clip
  if (editing) {
    label.value      = editing.label ?? ''
    position.value   = editing.position
    mediaStart.value = editing.mediaStart ?? 0
    mediaEnd.value   = editing.end ?? 100
    sourceId.value   = editing.sourceId ?? null
    fileId.value     = editing.fileId ?? null
    hue.value        = editing.hue ?? null
  } else {
    label.value      = ''
    position.value   = props.defaultPosition
    mediaStart.value = 0
    mediaEnd.value   = 100
    sourceId.value   = null
    fileId.value     = null
    hue.value        = null
  }

  pickedFile.value = null
  if (fileId.value) resolveFileName(fileId.value)
})

async function resolveFileName(id: string) {
  const { ok, data } = await $fetch<StorageFile[]>(
    `/api/production/${props.timeline?.productionId}/files`,
    { silent: true },
  )
  // Only apply if the dialog is still showing the clip we asked about.
  if (ok && fileId.value === id) pickedFile.value = (data ?? []).find(f => f.id === id) ?? null
}

function onFilePicked(file: StorageFile | null) {
  fileId.value         = file?.id ?? null
  pickedFile.value     = file
  filePickerOpen.value = false
}

const fileIcon = computed(() => {
  if (!fileId.value) return 'mdi:music-note-off'
  return pickedFile.value?.type === 'image' ? 'mdi:image-outline' : 'mdi:music-note'
})

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function close() { emit('update:open', false) }

function sourceColor(src: Source) {
  return src.hue != null ? `oklch(62% 0.17 ${src.hue})` : 'oklch(60% 0 0)'
}

function selectSource(src: Source) {
  sourceId.value = src.id
  submit()
}

function usePlayhead() {
  position.value = Math.max(0, Math.round(props.playheadFrame))
  tcValid.value  = { ...tcValid.value, position: true }
}

async function submit() {
  if (endFrameError.value || tcInvalid.value) return
  loading.value = true
  error.value   = ''

  const tlId = props.track?.timelineId ?? props.timeline?.id
  const url  = props.clip ? `/api/timeline/${tlId}/clips/${props.clip.id}` : `/api/timeline/${tlId}/clips`

  let modeFields
  if (sourceId.value != null) {
    modeFields = { sourceId: sourceId.value }
  } else if (isEventMode.value) {
    modeFields = { sourceId: null }
  } else {
    modeFields = {
      fileId:    fileId.value,
      mediaStart: Number(mediaStart.value),
      end:        Number(mediaEnd.value),
    }
  }

  const body = {
    ...(isEdit.value ? {} : { trackId: props.track?.id }),
    label:    label.value,
    position: Number(position.value),
    hue:      hue.value,
    ...modeFields,
  }

  const { ok, data, error: err } = await $fetch<EditorClip>(url, {
    method: isEdit.value ? 'PATCH' : 'POST',
    json:   body,
    silent: true,
  })
  loading.value = false
  if (!ok) { error.value = err ?? t('editor.failedToSaveClip'); return }
  // The API row has no fileType (only the bootstrap joins it), and without one
  // a new audio or image clip would render blank until the next reload.
  const fileType = data.fileId
    ? (pickedFile.value?.id === data.fileId ? pickedFile.value.type : props.clip?.fileType ?? null)
    : null
  emit('saved', { ...data, fileType })
}
</script>

<template>
  <SplitDialog
    :open="open"
    :title="isEdit ? $t('editor.editClipDialog.title') : $t('editor.addClipDialog.title')"
    :description="track?.name"
    :submit-label="isEdit ? $t('editor.save') : $t('editor.addClip')"
    :cancel-label="$t('editor.cancel')"
    :loading="loading"
    :disabled="!!endFrameError || tcInvalid"
    :error="error"
    :split="hasDetail"
    @update:open="!$event && close()"
    @submit="submit"
  >
    <template #left>
      <FormField for="cd-label" :label="$t('editor.clipLabel')">
        <Input id="cd-label" v-model="label" :placeholder="$t('editor.clipLabelPlaceholder')" maxlength="256" autofocus />
      </FormField>

      <FormField for="cd-pos" :label="$t('editor.clipPosition')">
        <div class="flex items-center gap-2">
          <div class="flex-1 min-w-0">
            <TimecodeInput
              id="cd-pos"
              v-model="position"
              :frame-rate="fps"
              @validity="tcValid = { ...tcValid, position: $event }"
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
        <p v-if="!tcValid.position" class="mt-1 text-xs text-destructive">{{ $t('editor.invalidTimecode') }}</p>
      </FormField>

      <!-- Hue override (null = inherit the track type's hue) -->
      <FormField :label="$t('editor.clipColor')">
        <div class="flex items-center gap-2">
          <HuePicker v-model="hueProxy" class="w-full" :class="hue === null ? 'opacity-50' : ''" />
          <Button
            v-if="hue !== null"
            type="button"
            variant="ghost"
            size="xs"
            class="shrink-0 text-muted-foreground"
            @click="hue = null"
          >
            {{ $t('editor.resetColor') }}
          </Button>
        </div>
      </FormField>
    </template>

    <template #right>
      <!-- Source grid: event-mode tracks with sources in their set -->
      <FormField v-if="hasSources" :label="$t('editor.clipSource')">
        <div class="grid grid-cols-4 gap-2">
          <button
            v-for="src in trackSources"
            :key="src.id"
            type="button"
            class="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border px-1.5 py-2.5 text-center transition-all"
            :class="sourceId === src.id
              ? 'border-primary bg-primary/5 ring-1 ring-primary'
              : 'border-border hover:border-muted-foreground/50 hover:bg-accent'"
            @click="selectSource(src)"
          >
            <div
              class="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm"
              :style="{ backgroundColor: sourceColor(src) }"
            >
              {{ src.shortName }}
            </div>
            <span class="mt-0.5 line-clamp-2 w-full text-center text-[10px] leading-tight text-foreground">
              {{ src.name }}
            </span>
          </button>
        </div>
      </FormField>

      <!-- Clip mode: file + media range -->
      <template v-else-if="!isEventMode">
        <FormField :label="$t('editor.file')">
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-sm
                     transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              @click="filePickerOpen = true"
            >
              <Icon :icon="fileIcon" class="size-4 shrink-0 text-muted-foreground" />
              <span class="flex-1 truncate text-left" :class="fileId ? 'text-foreground' : 'text-muted-foreground'">
                {{ pickedFile?.name ?? (fileId ? $t('editor.file') : $t('editor.noFile')) }}
              </span>
              <span v-if="pickedFile" class="shrink-0 text-xs text-muted-foreground">
                {{ formatSize(pickedFile.size) }}
              </span>
              <Icon icon="mdi:folder-open-outline" class="size-4 shrink-0 text-muted-foreground" />
            </button>

            <Button
              v-if="fileId"
              type="button"
              variant="ghost"
              size="xs"
              class="shrink-0 text-muted-foreground"
              :title="$t('editor.noFile')"
              @click="onFilePicked(null)"
            >
              <Icon icon="mdi:close" class="size-4" />
            </Button>
          </div>
        </FormField>

        <div class="flex gap-3">
          <FormField for="cd-ms" :label="$t('editor.mediaStart')" class="flex-1 min-w-0">
            <TimecodeInput
              id="cd-ms"
              v-model="mediaStart"
              :frame-rate="fps"
              @validity="tcValid = { ...tcValid, mediaStart: $event }"
            />
          </FormField>
          <FormField for="cd-end" :label="$t('editor.mediaEnd')" class="flex-1 min-w-0">
            <TimecodeInput
              id="cd-end"
              v-model="mediaEnd"
              :frame-rate="fps"
              :min="1"
              :class="endFrameError ? 'border-destructive' : ''"
              @validity="tcValid = { ...tcValid, mediaEnd: $event }"
            />
          </FormField>
        </div>
        <p v-if="!tcValid.mediaStart || !tcValid.mediaEnd" class="-mt-2 text-xs text-destructive">
          {{ $t('editor.invalidTimecode') }}
        </p>
        <p v-else-if="endFrameError" class="-mt-2 text-xs text-destructive">{{ endFrameError }}</p>
        <p v-else class="-mt-2 text-xs text-muted-foreground">
          {{ $t('editor.clipDuration') }}: <span class="font-mono tabular-nums">{{ durationTC }}</span>
        </p>
      </template>
    </template>
  </SplitDialog>

  <!-- v-if: the picker needs a production to browse, and the timeline
       arrives asynchronously. -->
  <SelectFileDialog
    v-if="timeline"
    :open="filePickerOpen"
    :production-id="timeline.productionId"
    :title="$t('editor.file')"
    :file-types="CLIP_FILE_TYPES"
    allow-none
    :none-label="$t('editor.noFile')"
    @select="onFilePicked"
    @close="filePickerOpen = false"
  />
</template>
