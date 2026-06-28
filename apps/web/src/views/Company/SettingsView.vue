<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import Avatar from '@starling/ui/Avatar'
import Image from '@starling/ui/Image'
import ImageCropper from '@starling/ui/ImageCropper'
import { useApi } from '../../composables/useApi.js'

const route  = useRoute()
const router = useRouter()
const { t } = useI18n()
const { $fetch } = useApi()

const company  = ref(null)
const loading  = ref(true)
const notFound = ref(false)

async function load() {
  loading.value = true
  const { ok, data, status } = await $fetch(`/api/company/${route.params.slug}`, { silent: true })
  loading.value = false
  if (status === 404) { notFound.value = true; return }
  if (!ok || !data.canManage) { router.replace(`/c/${route.params.slug}`); return }
  company.value = data
}

onMounted(load)

const profileUploading = ref(false)
const bannerUploading  = ref(false)
const profileError     = ref('')
const bannerError      = ref('')

async function uploadImage(slot, file) {
  const isProfile = slot === 'profile'
  if (isProfile) { profileUploading.value = true; profileError.value = '' }
  else           { bannerUploading.value  = true; bannerError.value  = '' }

  const fd = new FormData()
  fd.append('slot', slot)
  fd.append('file', file)

  const { ok, data, error } = await $fetch(
    `/api/company/${route.params.slug}/profile`,
    { method: 'POST', body: fd, silent: true },
  )

  if (isProfile) profileUploading.value = false
  else           bannerUploading.value  = false

  if (!ok) {
    if (isProfile) profileError.value = error ?? t('profile.uploadFailed')
    else           bannerError.value  = error ?? t('profile.uploadFailed')
    return
  }

  if (isProfile) company.value.profileImageId = data.fileId
  else           company.value.bannerImageId  = data.fileId
}

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
</script>

<template>
  <div class="container mx-auto px-6 py-10 max-w-3xl">
    <p v-if="loading" class="text-sm text-muted-foreground">…</p>
    <p v-else-if="notFound" class="text-sm text-destructive">{{ $t('company.couldNotLoad') }}</p>

    <template v-else-if="company">
      <div class="flex items-center gap-3 mb-8">
        <button class="text-muted-foreground hover:text-foreground transition-colors" @click="router.back()">
          <Icon icon="mdi:arrow-left" class="size-5" />
        </button>
        <h1 class="text-2xl font-bold">{{ $t('profile.companyTitle') }}</h1>
      </div>

      <div class="relative mb-6">
        <!-- Logo / avatar -->
        <label class="absolute z-10 left-4 bottom-4 size-28 cursor-pointer group">
          <div class="relative w-full h-full">
            <Avatar :id="company.profileImageId" class="w-full h-full rounded-2xl ring-2 ring-background">
              <span class="text-2xl font-bold text-muted-foreground">{{ company.name?.charAt(0)?.toUpperCase() }}</span>
            </Avatar>
            <div class="absolute inset-0 rounded-2xl flex items-center justify-center bg-black/0 group-hover:bg-black/45 transition-colors">
              <Icon
                :icon="profileUploading ? 'mdi:loading' : 'mdi:camera-outline'"
                :class="{ 'animate-spin': profileUploading }"
                class="text-white text-xl opacity-0 group-hover:opacity-100 transition-opacity"
              />
            </div>
          </div>
          <input type="file" accept="image/*" class="sr-only" @change="onProfilePick" />
        </label>

        <!-- Banner -->
        <label class="relative h-52 cursor-pointer group overflow-hidden rounded-2xl block">
          <div class="w-full h-full bg-secondary overflow-hidden">
            <Image v-if="company.bannerImageId" :id="company.bannerImageId" class="w-full h-full object-cover" />
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

      <p v-if="profileError" class="text-xs text-destructive mb-4">{{ profileError }}</p>

      <ImageCropper
        :file="cropFile"
        :aspect-ratio="cropSlot === 'banner' ? 3 : 1"
        :max-output="cropSlot === 'banner' ? 1800 : 600"
        @crop="onCropped"
        @cancel="onCropCancel"
      />

      <div class="border-t border-border pt-6">
        <p class="text-base font-semibold">{{ company.name }}</p>
        <p class="text-sm text-muted-foreground font-mono mt-0.5">{{ company.slug }}</p>
      </div>
    </template>
  </div>
</template>
