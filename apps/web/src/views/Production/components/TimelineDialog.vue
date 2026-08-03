<script setup>
import { ref, computed, inject, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Avatar, FormDialog, FormField, ImageCropper, Input, SelectMenu } from '@starling/ui'
import { useEntityDialog } from '../../../composables/useEntityDialog.js'
import { useApi } from '../../../composables/useApi.js'

const FRAME_RATES = ['23.976', '24', '25', '29.97', '29.97df', '30', '50', '59.94', '60']

const props = defineProps({
  open:     { type: Boolean, required: true },
  timeline: { type: Object,  default: null },
})

const emit = defineEmits(['update:open', 'created', 'updated'])

const data = inject('production-data')
const { t } = useI18n()
const { $fetch } = useApi()

const name            = ref('')
const frameRate       = ref('25')
const startFrame      = ref(0)
const endFrame        = ref(86400)
const ltcOffsetFrames = ref(0)

// Image state. A picked image can't be uploaded until the timeline has an id,
// so it waits here and goes up in afterSubmit — the same path for create and
// edit. `preview` is a local object URL so the dialog shows the new image
// before it exists on the server.
const profileImageId = ref(null)
const pendingImage   = ref(null)
const preview        = ref('')
const cropFile       = ref(null)

function clearPreview() {
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = ''
}

onBeforeUnmount(clearPreview)

function onImagePick(e) {
  const file = e.target.files?.[0]
  if (file) cropFile.value = file
  e.target.value = ''
}

function onCropped(blob) {
  clearPreview()
  pendingImage.value = new File([blob], 'image.jpg', { type: 'image/jpeg' })
  preview.value      = URL.createObjectURL(blob)
  cropFile.value     = null
}

const frameRateOptions = FRAME_RATES.map(r => ({ value: r, label: `${r} fps` }))

const endFrameError = computed(() =>
  endFrame.value <= startFrame.value ? t('timelines.endFrameMustBeAfterStart') : ''
)

const { isEdit, loading, error, submit } = useEntityDialog({
  open:   () => props.open,
  entity: () => props.timeline,
  emit,
  url:     () => `/api/timelines?pid=${data.value?.production?.id}`,
  itemUrl: (t) => `/api/timeline/${t.id}`,
  fill: (tl) => {
    name.value            = tl.name
    frameRate.value       = tl.frameRate
    startFrame.value      = tl.startFrame
    endFrame.value        = tl.endFrame
    ltcOffsetFrames.value = tl.ltcOffsetFrames
    profileImageId.value  = tl.profileImageId ?? null
    pendingImage.value    = null
    clearPreview()
  },
  reset: () => {
    name.value = ''; frameRate.value = '25'; startFrame.value = 0; endFrame.value = 86400; ltcOffsetFrames.value = 0
    profileImageId.value = null
    pendingImage.value   = null
    clearPreview()
  },
  payload: () => ({
    name:            name.value.trim(),
    frameRate:       frameRate.value,
    startFrame:      Number(startFrame.value),
    endFrame:        Number(endFrame.value),
    ltcOffsetFrames: Number(ltcOffsetFrames.value),
  }),
  // The timeline is saved either way; a failed image upload must not read as a
  // failed save, so it only drops the image and lets the row through.
  afterSubmit: async (saved) => {
    if (!pendingImage.value) return
    const body = new FormData()
    body.append('file', pendingImage.value)
    const { ok, data: uploaded } = await $fetch(`/api/timeline/${saved.id}/profile`, { method: 'POST', body, silent: true })
    pendingImage.value = null
    clearPreview()
    if (ok) return { ...saved, profileImageId: uploaded.fileId }
  },
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
    <div class="flex items-center gap-4">
      <label class="group relative size-16 shrink-0 cursor-pointer">
        <img v-if="preview" :src="preview" alt="" class="size-16 rounded-xl object-cover" />
        <Avatar v-else :id="profileImageId" class="size-16 rounded-xl">
          <Icon icon="mdi:movie-open-outline" class="size-7 text-muted-foreground/75" />
        </Avatar>
        <div class="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 transition-colors group-hover:bg-black/45">
          <Icon icon="mdi:camera-outline" class="text-white opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
        <input type="file" accept="image/*" class="sr-only" @change="onImagePick" />
      </label>

      <div class="min-w-0">
        <p class="text-sm font-medium">{{ $t('timelines.image') }}</p>
        <p class="text-xs text-muted-foreground">{{ $t('timelines.imageHint') }}</p>
      </div>
    </div>

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

    <ImageCropper :file="cropFile" :aspect-ratio="1" :max-output="600" @crop="onCropped" @cancel="cropFile = null" />
  </FormDialog>
</template>
