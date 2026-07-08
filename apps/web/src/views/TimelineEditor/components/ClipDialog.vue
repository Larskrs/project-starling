<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import Dialog        from '@starling/ui/Dialog'
import DialogContent from '@starling/ui/DialogContent'
import DialogHeader  from '@starling/ui/DialogHeader'
import DialogTitle   from '@starling/ui/DialogTitle'
import DialogFooter  from '@starling/ui/DialogFooter'
import { Input, Label, Button, Skeleton } from '@starling/ui'
import HuePicker from '../../Production/components/HuePicker.vue'
import { useApi } from '../../../composables/useApi.js'

const props = defineProps({
  open:            { type: Boolean, required: true },
  track:           { type: Object,  default: null },
  clip:            { type: Object,  default: null },
  trackSources:    { type: Array,   default: () => [] },
  defaultPosition: { type: Number,  default: 0 },
  timeline:        { type: Object,  default: null },
})

const emit = defineEmits(['update:open', 'saved'])

const { t }      = useI18n()
const { $fetch } = useApi()

const label      = ref('')
const position   = ref(0)
const mediaStart = ref(0)
const mediaEnd   = ref(100)
const sourceId   = ref(null)
const fileId     = ref(null)
const hue        = ref(null)   // null = inherit the track type's hue
const loading    = ref(false)
const error      = ref('')

// HuePicker needs a number; null shows the neutral default until the user drags.
const hueProxy = computed({
  get: () => hue.value ?? 250,
  set: (v) => { hue.value = v },
})

// Audio file list (loaded when clip-mode dialog opens)
const audioFiles    = ref([])
const loadingFiles  = ref(false)

const isEdit      = computed(() => props.clip !== null)
const isEventMode = computed(() => props.track?.mode === 'event')
// Source grid only applies to event-mode tracks with sources.
const hasSources  = computed(() => isEventMode.value && props.trackSources.length > 0)

const endFrameError = computed(() =>
  !isEventMode.value && !fileId.value && mediaEnd.value <= mediaStart.value
    ? t('editor.endMustBeAfterStart')
    : '',
)

watch(() => props.open, async (open) => {
  if (!open) return
  error.value   = ''
  loading.value = false

  if (isEdit.value) {
    label.value      = props.clip.label ?? ''
    position.value   = props.clip.position
    mediaStart.value = props.clip.mediaStart ?? 0
    mediaEnd.value   = props.clip.end ?? 100
    sourceId.value   = props.clip.sourceId ?? null
    fileId.value     = props.clip.fileId ?? null
    hue.value        = props.clip.hue ?? null
  } else {
    label.value      = ''
    position.value   = props.defaultPosition
    mediaStart.value = 0
    mediaEnd.value   = 100
    sourceId.value   = null
    fileId.value     = null
    hue.value        = null
  }

  if (!isEventMode.value && audioFiles.value.length === 0) {
    await loadAudioFiles()
  }
})

async function loadAudioFiles() {
  loadingFiles.value = true
  const { ok, data } = await $fetch(
    `/api/production/${props.timeline?.productionId}/files?type=audio`,
    { silent: true },
  )
  loadingFiles.value = false
  if (ok) audioFiles.value = data ?? []
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function close() { emit('update:open', false) }

function sourceColor(src) {
  return src.hue != null ? `oklch(62% 0.17 ${src.hue})` : 'oklch(60% 0 0)'
}

function selectSource(src) {
  sourceId.value = src.id
  submit()
}

async function submit() {
  if (endFrameError.value) return
  loading.value = true
  error.value   = ''

  const tlId = props.track?.timelineId ?? props.timeline?.id
  const url  = isEdit.value ? `/api/timeline/${tlId}/clips/${props.clip.id}` : `/api/timeline/${tlId}/clips`

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

  const { ok, data, error: err } = await $fetch(url, {
    method: isEdit.value ? 'PATCH' : 'POST',
    json:   body,
    silent: true,
  })
  loading.value = false
  if (!ok) { error.value = err ?? t('editor.failedToSaveClip'); return }
  emit('saved', data)
}
</script>

<template>
  <Dialog :open="open" @update:open="!$event && close()">
    <DialogContent class="max-w-sm p-6 flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>
          {{ isEdit ? $t('editor.editClipDialog.title') : $t('editor.addClipDialog.title') }}
          <span v-if="track" class="font-normal text-muted-foreground text-sm ml-1">— {{ track.name }}</span>
        </DialogTitle>
      </DialogHeader>

      <form class="flex flex-col gap-3" @submit.prevent="submit">

        <!-- Label -->
        <div class="flex flex-col gap-1.5">
          <Label for="cd-label">{{ $t('editor.clipLabel') }}</Label>
          <Input
            id="cd-label"
            v-model="label"
            :placeholder="$t('editor.clipLabelPlaceholder')"
            maxlength="256"
            autofocus
          />
        </div>

        <!-- Position -->
        <div class="flex flex-col gap-1.5">
          <Label for="cd-pos">{{ $t('editor.clipPosition') }}</Label>
          <Input id="cd-pos" v-model.number="position" type="number" min="0" step="1" />
        </div>

        <!-- Source grid: event-mode tracks with sources in their set -->
        <template v-if="hasSources">
          <div class="flex flex-col gap-2">
            <Label>{{ $t('editor.clipSource') }}</Label>
            <div class="grid grid-cols-4 gap-2">
              <button
                v-for="src in trackSources"
                :key="src.id"
                type="button"
                class="flex flex-col items-center gap-1.5 rounded-lg border px-1.5 py-2.5 text-center transition-all cursor-pointer"
                :class="sourceId === src.id
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-muted-foreground/50 hover:bg-accent'"
                @click="selectSource(src)"
              >
                <div
                  class="size-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 shadow-sm"
                  :style="{ backgroundColor: sourceColor(src) }"
                >
                  {{ src.shortName }}
                </div>
                <span class="text-[10px] leading-tight text-foreground text-center line-clamp-2 w-full mt-0.5">
                  {{ src.name }}
                </span>
              </button>
            </div>
          </div>
        </template>

        <!-- Clip mode: file + media range -->
        <template v-else-if="!isEventMode">

          <!-- Audio file picker -->
          <div class="flex flex-col gap-1.5">
            <Label>{{ $t('editor.file') }}</Label>

            <div v-if="loadingFiles" class="flex flex-col gap-1">
              <Skeleton v-for="i in 3" :key="i" class="h-9 rounded-md" />
            </div>

            <p v-else-if="audioFiles.length === 0" class="text-xs text-muted-foreground">
              {{ $t('editor.noAudioFiles') }}
            </p>

            <div v-else class="flex flex-col max-h-36 overflow-y-auto rounded-md border border-border divide-y divide-border">
              <!-- No file option -->
              <button
                type="button"
                class="flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left"
                :class="fileId === null ? 'bg-muted text-muted-foreground' : 'hover:bg-accent text-muted-foreground'"
                @click="fileId = null"
              >
                <Icon icon="mdi:music-note-off" class="size-3.5 shrink-0 opacity-50" />
                <span class="italic">{{ $t('editor.noFile') }}</span>
              </button>
              <button
                v-for="f in audioFiles"
                :key="f.id"
                type="button"
                class="flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left"
                :class="fileId === f.id
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'hover:bg-accent'"
                @click="fileId = f.id"
              >
                <Icon icon="mdi:music-note" class="size-3.5 shrink-0" />
                <span class="truncate flex-1">{{ f.name }}</span>
                <span class="text-xs text-muted-foreground shrink-0">{{ formatSize(f.size) }}</span>
              </button>
            </div>
          </div>

          <!-- Media range -->
          <div class="flex gap-3">
            <div class="flex flex-col gap-1.5 flex-1">
              <Label for="cd-ms">{{ $t('editor.mediaStart') }}</Label>
              <Input id="cd-ms" v-model.number="mediaStart" type="number" min="0" step="1" />
            </div>
            <div class="flex flex-col gap-1.5 flex-1">
              <Label for="cd-end">{{ $t('editor.mediaEnd') }}</Label>
              <Input
                id="cd-end"
                v-model.number="mediaEnd"
                type="number"
                min="1"
                step="1"
                :class="endFrameError ? 'border-destructive' : ''"
              />
            </div>
          </div>
          <p v-if="endFrameError" class="text-xs text-destructive -mt-1">{{ endFrameError }}</p>

        </template>

        <!-- Hue override (null = inherit the track type's hue) -->
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between">
            <Label>{{ $t('editor.clipColor') }}</Label>
            <button
              v-if="hue !== null"
              type="button"
              class="text-xs text-muted-foreground hover:text-foreground transition-colors"
              @click="hue = null"
            >{{ $t('editor.resetColor') }}</button>
          </div>
          <HuePicker v-model="hueProxy" :class="hue === null ? 'opacity-50' : ''" />
        </div>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

        <DialogFooter class="pt-1">
          <Button type="button" variant="outline" @click="close">{{ $t('editor.cancel') }}</Button>
          <Button
            v-if="!hasSources"
            type="submit"
            :disabled="!!endFrameError || loading"
          >
            {{ loading ? '…' : (isEdit ? $t('editor.save') : $t('editor.addClip')) }}
          </Button>
          <Button
            v-else
            type="submit"
            variant="outline"
            :disabled="loading"
          >
            {{ loading ? '…' : $t('editor.save') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
