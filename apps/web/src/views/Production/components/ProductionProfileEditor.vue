<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import Avatar from '@starling/ui/Avatar'
import ProductionBanner from '@starling/ui/ProductionBanner'
import ImageCropper from '@starling/ui/ImageCropper'
import { useApi } from '../../../composables/useApi.js'

const props = defineProps({
  uploadUrl:      { type: String, required: true },
  profileImageId: { type: String, default: null },
  bannerImageId:  { type: String, default: null },
  bannerSrc:      { type: String, default: null },
})

const emit = defineEmits(['uploaded'])

const { t }      = useI18n()
const { $fetch } = useApi()

const profileUploading = ref(false)
const bannerUploading  = ref(false)
const profileError     = ref('')
const bannerError      = ref('')

const cropFile = ref(null)
const cropSlot = ref('')

function onProfilePick(e) {
  const f = e.target.files?.[0]
  if (f) { cropFile.value = f; cropSlot.value = 'profile' }
  e.target.value = ''
}

function onBannerPick(e) {
  const f = e.target.files?.[0]
  if (f) { cropFile.value = f; cropSlot.value = 'banner' }
  e.target.value = ''
}

function onCropped(blob) {
  const file = new File([blob], 'image.jpg', { type: 'image/jpeg' })
  uploadImage(cropSlot.value, file)
  cropFile.value = null
  cropSlot.value = ''
}

function onCropCancel() {
  cropFile.value = null
  cropSlot.value = ''
}

async function uploadImage(slot, file) {
  const isProfile = slot === 'profile'
  if (isProfile) { profileUploading.value = true; profileError.value = '' }
  else           { bannerUploading.value  = true; bannerError.value  = '' }

  const fd = new FormData()
  fd.append('slot', slot)
  fd.append('file', file)

  const { ok, data, error } = await $fetch(props.uploadUrl, { method: 'POST', body: fd, silent: true })

  if (isProfile) profileUploading.value = false
  else           bannerUploading.value  = false

  if (!ok) {
    if (isProfile) profileError.value = error ?? t('settings.uploadFailed')
    else           bannerError.value  = error ?? t('settings.uploadFailed')
    return
  }

  emit('uploaded', { slot, fileId: data.fileId })
}
</script>

<template>
  <div>
    <div class="relative items-center">

      <label class="absolute z-10 left-4 bottom-4 size-32 cursor-pointer group">
        <div class="relative w-full h-full">
          <Avatar :id="profileImageId" class="w-full h-full rounded-2xl ring-2 ring-white">
            <Icon icon="mdi:image-outline" class="size-12 text-muted-foreground/75" />
          </Avatar>
          <div class="absolute inset-0 rounded-2xl flex items-center justify-center bg-black/0 group-hover:bg-black/45 transition-colors">
            <Icon
              :icon="profileUploading ? 'mdi:loading' : 'mdi:camera-outline'"
              :class="{ 'animate-spin': profileUploading }"
              class="text-white text-sm opacity-0 group-hover:opacity-100 transition-opacity"
            />
          </div>
        </div>
        <input type="file" accept="image/*" class="sr-only" @change="onProfilePick" />
      </label>

      <label class="relative h-60 cursor-pointer group overflow-hidden rounded-2xl block">
        <ProductionBanner :src="bannerSrc" class="h-full w-full object-cover" />
        <div class="absolute inset-0 flex items-center justify-center transition-colors bg-black/0 group-hover:bg-black/25">
          <div class="flex items-center gap-1.5 bg-black/60 text-white text-xs px-2.5 py-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity">
            <Icon :icon="bannerUploading ? 'mdi:loading' : 'mdi:camera-outline'" :class="{ 'animate-spin': bannerUploading }" />
            {{ bannerUploading ? $t('settings.uploading') : $t('settings.changeBanner') }}
          </div>
        </div>
        <input type="file" accept="image/*" class="sr-only" @change="onBannerPick" />
        <p v-if="bannerError" class="absolute bottom-2 right-2 text-xs bg-destructive text-destructive-foreground px-2 py-0.5 rounded">{{ bannerError }}</p>
      </label>

    </div>

    <p v-if="profileError" class="mt-2 text-xs text-destructive">{{ profileError }}</p>

    <ImageCropper
      :file="cropFile"
      :aspect-ratio="cropSlot === 'banner' ? (16/9) : 1"
      :max-output="cropSlot === 'banner' ? 1920 : 600"
      @crop="onCropped"
      @cancel="onCropCancel"
    />
  </div>
</template>
