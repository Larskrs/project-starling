<script setup>
import { inject, ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Icon } from '@iconify/vue'
import SquircleAvatar from '../../components/ui/SquircleAvatar.vue'
import ProductionBanner from '../../components/ui/ProductionBanner.vue'

const route = useRoute()
const data  = inject('production-data')

// ── Name editing ─────────────────────────────────────────────────────────────

const nameInput  = ref('')
const nameSaving = ref(false)
const nameError  = ref('')
const nameSuccess = ref(false)

watch(
  () => data?.value?.production?.name,
  (v) => { if (v) nameInput.value = v },
  { immediate: true },
)

async function saveName() {
  if (!nameInput.value.trim() || nameInput.value === data.value?.production?.name) return
  nameSaving.value = true
  nameError.value  = ''
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
      const err = await res.json().catch(() => ({}))
      nameError.value = err.message ?? 'Failed to save'
      return
    }
    const updated = await res.json()
    data.value.production.name = updated.name
    nameSuccess.value = true
    setTimeout(() => { nameSuccess.value = false }, 2000)
  } catch {
    nameError.value = 'Network error'
  } finally {
    nameSaving.value = false
  }
}

// ── Image helpers ─────────────────────────────────────────────────────────────

function imageUrl(fileId, quality = 67) {
  if (!fileId) return null
  return `/api/storage/${fileId}/serve?quality=${quality}`
}

const profileSrc = computed(() => imageUrl(data.value?.production?.profileImageId))
const bannerSrc  = computed(() => imageUrl(data.value?.production?.bannerImageId))

// ── Image upload ─────────────────────────────────────────────────────────────

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
      const err = await res.json().catch(() => ({}))
      const msg = err.message ?? 'Upload failed'
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

function onProfilePick(e) {
  const file = e.target.files?.[0]
  if (file) uploadImage('profile', file)
  e.target.value = ''
}

function onBannerPick(e) {
  const file = e.target.files?.[0]
  if (file) uploadImage('banner', file)
  e.target.value = ''
}

const nameChanged = computed(() =>
  nameInput.value.trim() !== '' && nameInput.value !== data.value?.production?.name,
)
</script>

<template>
  <div class="p-6 max-w-2xl space-y-10">

    <!-- Header -->
    <div>
      <h2 class="text-lg font-semibold text-foreground mb-0.5">Settings</h2>
      <p class="text-sm text-muted-foreground">Manage your production details and branding.</p>
    </div>

    <!-- Banner -->
    <section class="space-y-3">
      <div>
        <p class="text-sm font-medium text-foreground">Banner</p>
        <p class="text-xs text-muted-foreground mt-0.5">Wide image shown at the top of your production page.</p>
      </div>

      <ProductionBanner :src="bannerSrc" :height="140">
        <Icon icon="mdi:image-outline" class="text-4xl" />
      </ProductionBanner>

      <div class="flex items-center gap-3">
        <label class="cursor-pointer">
          <input type="file" accept="image/*" class="sr-only" @change="onBannerPick" />
          <span
            class="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-border bg-background hover:bg-secondary transition-colors"
            :class="bannerUploading ? 'opacity-50 pointer-events-none' : ''"
          >
            <Icon v-if="bannerUploading" icon="mdi:loading" class="animate-spin" />
            <Icon v-else icon="mdi:upload" />
            {{ bannerUploading ? 'Uploading…' : 'Upload banner' }}
          </span>
        </label>
        <p v-if="bannerError" class="text-xs text-destructive">{{ bannerError }}</p>
      </div>
    </section>

    <!-- Profile image -->
    <section class="space-y-3">
      <div>
        <p class="text-sm font-medium text-foreground">Profile image</p>
        <p class="text-xs text-muted-foreground mt-0.5">Square image used as the production icon.</p>
      </div>

      <SquircleAvatar :src="profileSrc" :size="96">
        <Icon icon="mdi:image-outline" class="text-2xl" />
      </SquircleAvatar>

      <div class="flex items-center gap-3">
        <label class="cursor-pointer">
          <input type="file" accept="image/*" class="sr-only" @change="onProfilePick" />
          <span
            class="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-border bg-background hover:bg-secondary transition-colors"
            :class="profileUploading ? 'opacity-50 pointer-events-none' : ''"
          >
            <Icon v-if="profileUploading" icon="mdi:loading" class="animate-spin" />
            <Icon v-else icon="mdi:upload" />
            {{ profileUploading ? 'Uploading…' : 'Upload image' }}
          </span>
        </label>
        <p v-if="profileError" class="text-xs text-destructive">{{ profileError }}</p>
      </div>
    </section>

    <hr class="border-border" />

    <!-- Production name -->
    <section class="space-y-3">
      <div>
        <p class="text-sm font-medium text-foreground">Production name</p>
        <p class="text-xs text-muted-foreground mt-0.5">The display name for this production.</p>
      </div>

      <div class="flex items-center gap-2">
        <input
          v-model="nameInput"
          type="text"
          maxlength="255"
          placeholder="Production name"
          class="flex-1 h-8 px-3 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          @keydown.enter="saveName"
        />
        <button
          :disabled="!nameChanged || nameSaving"
          class="h-8 px-3 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          @click="saveName"
        >
          <Icon v-if="nameSaving" icon="mdi:loading" class="animate-spin" />
          <Icon v-else-if="nameSuccess" icon="mdi:check" />
          {{ nameSaving ? 'Saving…' : nameSuccess ? 'Saved' : 'Save' }}
        </button>
      </div>
      <p v-if="nameError" class="text-xs text-destructive">{{ nameError }}</p>
    </section>

  </div>
</template>
