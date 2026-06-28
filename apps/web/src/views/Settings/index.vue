<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import Avatar from '@starling/ui/Avatar'
import ImageCropper from '@starling/ui/ImageCropper'
import { useApi } from '../../composables/useApi.js'

const { $fetch } = useApi()
const { t } = useI18n()

const profile = ref(null)

async function fetchProfile() {
  const { ok, data } = await $fetch('/api/user/me')
  if (ok) profile.value = data
}

onMounted(fetchProfile)

const avatarUploading = ref(false)
const bannerUploading = ref(false)
const avatarError     = ref('')
const bannerError     = ref('')

async function uploadImage(slot, file) {
  const isAvatar = slot === 'avatar'
  if (isAvatar) { avatarUploading.value = true; avatarError.value = '' }
  else          { bannerUploading.value = true; bannerError.value = '' }

  const fd = new FormData()
  fd.append('slot', slot)
  fd.append('file', file)

  const { ok, error } = await $fetch('/api/user/profile', { method: 'POST', body: fd, silent: true })

  if (isAvatar) avatarUploading.value = false
  else          bannerUploading.value = false

  if (!ok) {
    if (isAvatar) avatarError.value = error ?? t('profile.uploadFailed')
    else          bannerError.value = error ?? t('profile.uploadFailed')
    return
  }

  await fetchProfile()
}

const cropFile = ref(null)
const cropSlot = ref('')

function onAvatarPick(e) {
  const f = e.target.files?.[0]
  if (f) { cropFile.value = f; cropSlot.value = 'avatar' }
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
</script>

<template>
  <div class="container mx-auto px-6 py-10 max-w-3xl">
    <h1 class="text-2xl font-bold mb-8">{{ $t('profile.title') }}</h1>

    <div class="relative mb-6">
      <!-- Avatar -->
      <label class="absolute z-10 left-4 bottom-4 size-28 cursor-pointer group">
        <div class="relative w-full h-full">
          <Avatar :id="profile?.avatarImageId" class="w-full h-full rounded-2xl ring-2 ring-background">
            <span class="text-2xl font-bold text-muted-foreground">{{ profile?.first_name?.charAt(0)?.toUpperCase() }}</span>
          </Avatar>
          <div class="absolute inset-0 rounded-2xl flex items-center justify-center bg-black/0 group-hover:bg-black/45 transition-colors">
            <Icon
              :icon="avatarUploading ? 'mdi:loading' : 'mdi:camera-outline'"
              :class="{ 'animate-spin': avatarUploading }"
              class="text-white text-xl opacity-0 group-hover:opacity-100 transition-opacity"
            />
          </div>
        </div>
        <input type="file" accept="image/*" class="sr-only" @change="onAvatarPick" />
      </label>

      <!-- Banner -->
      <label class="relative h-52 cursor-pointer group overflow-hidden rounded-2xl block">
        <div class="w-full h-full bg-secondary overflow-hidden">
          <Image v-if="profile?.bannerImageId" :id="profile.bannerImageId" class="w-full h-full object-cover" />
        </div>
        <div class="absolute inset-0 flex items-center justify-center transition-colors bg-black/0 group-hover:bg-black/25">
          <div class="flex items-center gap-1.5 bg-black/60 text-white text-xs px-2.5 py-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity">
            <Icon :icon="bannerUploading ? 'mdi:loading' : 'mdi:camera-outline'" :class="{ 'animate-spin': bannerUploading }" />
            {{ bannerUploading ? $t('profile.uploading') : $t('profile.changeBanner') }}
          </div>
        </div>
        <input type="file" accept="image/*" class="sr-only" @change="onBannerPick" />
        <p v-if="bannerError" class="absolute bottom-2 right-2 text-xs bg-destructive text-destructive-foreground px-2 py-0.5 rounded">{{ bannerError }}</p>
      </label>
    </div>

    <p v-if="avatarError" class="text-xs text-destructive mb-4">{{ avatarError }}</p>

    <ImageCropper
      :file="cropFile"
      :aspect-ratio="cropSlot === 'banner' ? 3 : 1"
      :max-output="cropSlot === 'banner' ? 1800 : 600"
      @crop="onCropped"
      @cancel="onCropCancel"
    />

    <div class="border-t border-border pt-6 space-y-1">
      <p class="text-sm font-medium">{{ profile?.first_name }} {{ profile?.last_name }}</p>
      <p class="text-sm text-muted-foreground">{{ profile?.email }}</p>
    </div>
  </div>
</template>
