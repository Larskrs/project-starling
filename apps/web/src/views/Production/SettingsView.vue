<script setup>
import { inject, ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { Icon } from '@iconify/vue'
import Avatar from '@starling/ui/Avatar'
import ProductionBanner from '@starling/ui/ProductionBanner'
import ImageCropper from '@starling/ui/ImageCropper'
import Button from '@starling/ui/Button'
import Input from '@starling/ui/Input'
import Label from '@starling/ui/Label'
import { useApi } from '../../composables/useApi.js'

const route = useRoute()
const data  = inject('production-data')
const { t } = useI18n()
const { $fetch } = useApi()

// ── Name ──────────────────────────────────────────────────────────────────────

const nameInput   = ref('')
const nameSaving  = ref(false)
const nameError   = ref('')
const nameSuccess = ref(false)

watch(
  () => data?.value?.production?.name,
  (v) => { if (v) nameInput.value = v },
  { immediate: true },
)

async function saveName() {
  if (!nameInput.value.trim() || nameInput.value === data.value?.production?.name) return
  nameSaving.value  = true
  nameError.value   = ''
  nameSuccess.value = false
  const { ok, data: resData, error } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}`,
    { method: 'PATCH', json: { name: nameInput.value.trim() }, silent: true },
  )
  nameSaving.value = false
  if (!ok) { nameError.value = error ?? t('settings.failedToSave'); return }
  data.value.production.name = resData.name
  nameSuccess.value = true
  setTimeout(() => { nameSuccess.value = false }, 2000)
}

// ── Images ────────────────────────────────────────────────────────────────────

const profileSrc = computed(() => data.value?.production?.profileImageId
  ? `/api/storage/${data.value.production.profileImageId}/serve?quality=67` : null)

const bannerSrc = computed(() => data.value?.production?.bannerImageId
  ? `/api/storage/${data.value.production.bannerImageId}/serve?quality=67` : null)

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
  const { ok, data: resData, error } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/profile`,
    { method: 'POST', body: fd, silent: true },
  )
  if (isProfile) profileUploading.value = false
  else           bannerUploading.value  = false
  if (!ok) {
    if (isProfile) profileError.value = error ?? t('settings.uploadFailed')
    else           bannerError.value  = error ?? t('settings.uploadFailed')
    return
  }
  if (isProfile) data.value.production.profileImageId = resData.fileId
  else           data.value.production.bannerImageId  = resData.fileId
}

// ── Crop flow ─────────────────────────────────────────────────────────────────

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

const nameChanged = computed(() =>
  nameInput.value.trim() !== '' && nameInput.value !== data.value?.production?.name,
)
</script>

<template>
  <div class="max-w-3xl mx-auto px-6 py-8 space-y-6">

    <!-- Images -->
    <div class="relative items-center">

      <!-- Avatar -->
      <label class="absolute z-10 left-4 bottom-4 size-32 cursor-pointer group">
        <div class="relative w-full h-full">
          <Avatar :src="profileSrc" class="w-full h-full rounded-2xl ring-2 ring-white">
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

      <!-- Banner -->
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

    <p v-if="profileError" class="text-xs text-destructive">{{ profileError }}</p>

    <ImageCropper
      :file="cropFile"
      :aspect-ratio="cropSlot === 'banner' ? 3 : 1"
      :max-output="cropSlot === 'banner' ? 1800 : 600"
      @crop="onCropped"
      @cancel="onCropCancel"
    />

    <div class="border-t border-border" />

    <!-- Name -->
    <div class="space-y-1.5">
      <Label for="production-name">{{ $t('settings.productionName') }}</Label>
      <div class="flex gap-2">
        <Input
          id="production-name"
          v-model="nameInput"
          maxlength="255"
          :placeholder="$t('settings.productionName')"
          class="h-9 text-sm"
          @keydown.enter="saveName"
        />
        <Button
          size="sm"
          :disabled="!nameChanged || nameSaving"
          class="shrink-0 gap-1.5"
          @click="saveName"
        >
          <Icon v-if="nameSaving" icon="mdi:loading" class="animate-spin" />
          <Icon v-else-if="nameSuccess" icon="mdi:check" />
          {{ nameSaving ? $t('settings.saving') : nameSuccess ? $t('settings.saved') : $t('settings.save') }}
        </Button>
      </div>
      <p v-if="nameError" class="text-xs text-destructive">{{ nameError }}</p>
    </div>

  </div>
</template>
