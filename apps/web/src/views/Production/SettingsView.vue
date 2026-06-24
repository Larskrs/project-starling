<script setup>
import { inject, ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Icon } from '@iconify/vue'
import SquircleAvatar from '../../components/ui/SquircleAvatar.vue'
import ProductionBanner from '../../components/ui/ProductionBanner.vue'
import Button from '../../components/ui/Button.vue'
import Input from '../../components/ui/Input.vue'
import Label from '../../components/ui/Label.vue'

const route = useRoute()
const data  = inject('production-data')

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
  try {
    const res = await fetch(
      `/api/company/${route.params.cslug}/production/${route.params.pslug}`,
      {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: nameInput.value.trim() }),
        credentials: 'include',
      },
    )
    if (!res.ok) {
      nameError.value = (await res.json().catch(() => ({}))).message ?? 'Failed to save'
      return
    }
    data.value.production.name = (await res.json()).name
    nameSuccess.value = true
    setTimeout(() => { nameSuccess.value = false }, 2000)
  } catch {
    nameError.value = 'Network error'
  } finally {
    nameSaving.value = false
  }
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
  try {
    const fd = new FormData()
    fd.append('slot', slot)
    fd.append('file', file)
    const res = await fetch(
      `/api/company/${route.params.cslug}/production/${route.params.pslug}/profile`,
      { method: 'POST', body: fd, credentials: 'include' },
    )
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({}))).message ?? 'Upload failed'
      if (isProfile) profileError.value = msg
      else           bannerError.value  = msg
      return
    }
    const { fileId } = await res.json()
    if (isProfile) data.value.production.profileImageId = fileId
    else           data.value.production.bannerImageId  = fileId
  } catch {
    if (isProfile) profileError.value = 'Network error'
    else           bannerError.value  = 'Network error'
  } finally {
    if (isProfile) profileUploading.value = false
    else           bannerUploading.value  = false
  }
}

function onProfilePick(e) { const f = e.target.files?.[0]; if (f) uploadImage('profile', f); e.target.value = '' }
function onBannerPick(e)  { const f = e.target.files?.[0]; if (f) uploadImage('banner',  f); e.target.value = '' }

const nameChanged = computed(() =>
  nameInput.value.trim() !== '' && nameInput.value !== data.value?.production?.name,
)
</script>

<template>
  <div class="max-w-3xl mx-auto px-6 py-8 space-y-6">

    <!-- Images -->
    <div class="relative items-center">

      <!-- Avatar -->
      <label class="absolute z-10 left-4 bottom-4 size-32 aspect-square cursor-pointer group">
        <SquircleAvatar :src="profileSrc" />
        <div class="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/45 transition-colors rounded-2xl">
          <Icon
            :icon="profileUploading ? 'mdi:loading' : 'mdi:camera-outline'"
            :class="{ 'animate-spin': profileUploading }"
            class="text-white text-sm opacity-0 group-hover:opacity-100 transition-opacity"
          />
        </div>
        <input type="file" accept="image/*" class="sr-only" @change="onProfilePick" />
      </label>

      <!-- Banner -->
      <label class="relative h-60 cursor-pointer group overflow-hidden rounded-xl block">
        <ProductionBanner :src="bannerSrc" class="h-full w-full object-cover" />
        <div class="absolute inset-0 flex items-center justify-center transition-colors bg-black/0 group-hover:bg-black/25">
          <div class="flex items-center gap-1.5 bg-black/60 text-white text-xs px-2.5 py-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity">
            <Icon :icon="bannerUploading ? 'mdi:loading' : 'mdi:camera-outline'" :class="{ 'animate-spin': bannerUploading }" />
            {{ bannerUploading ? 'Uploading…' : 'Change banner' }}
          </div>
        </div>
        <input type="file" accept="image/*" class="sr-only" @change="onBannerPick" />
        <p v-if="bannerError" class="absolute bottom-2 right-2 text-xs bg-destructive text-destructive-foreground px-2 py-0.5 rounded">{{ bannerError }}</p>
      </label>

    </div>

    <p v-if="profileError" class="text-xs text-destructive">{{ profileError }}</p>

    <div class="border-t border-border" />

    <!-- Name -->
    <div class="space-y-1.5">
      <Label for="production-name">Production name</Label>
      <div class="flex gap-2">
        <Input
          id="production-name"
          v-model="nameInput"
          maxlength="255"
          placeholder="Production name"
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
          {{ nameSaving ? 'Saving…' : nameSuccess ? 'Saved' : 'Save' }}
        </Button>
      </div>
      <p v-if="nameError" class="text-xs text-destructive">{{ nameError }}</p>
    </div>

  </div>
</template>
