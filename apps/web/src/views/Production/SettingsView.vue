<script setup>
import { inject, ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { Icon } from '@iconify/vue'
import Button from '@starling/ui/Button'
import Input from '@starling/ui/Input'
import Label from '@starling/ui/Label'
import { useApi } from '../../composables/useApi.js'
import ProductionProfileEditor from './components/ProductionProfileEditor.vue'

const route = useRoute()
const data  = inject('production-data')
const { t } = useI18n()
const { $fetch } = useApi()

const uploadUrl = computed(() =>
  `/api/company/${route.params.cslug}/production/${route.params.pslug}/profile`,
)

const bannerSrc = computed(() => data.value?.production?.bannerImageId
  ? `/api/storage/${data.value.production.bannerImageId}/serve?quality=67` : null)

function onUploaded({ slot, fileId }) {
  if (slot === 'profile') data.value.production.profileImageId = fileId
  else                    data.value.production.bannerImageId  = fileId
}

// ── Name ──────────────────────────────────────────────────────────────────────
const nameInput   = ref('')
const nameSaving  = ref(false)
const nameError   = ref('')
const nameSuccess = ref(false)

watch(() => data?.value?.production?.name, (v) => { if (v) nameInput.value = v }, { immediate: true })

const nameChanged = computed(() =>
  nameInput.value.trim() !== '' && nameInput.value !== data.value?.production?.name,
)

async function saveName() {
  if (!nameChanged.value) return
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

// ── Storage limit ─────────────────────────────────────────────────────────────
const UNITS = { mb: 1024 ** 2, gb: 1024 ** 3 }

const storageInput   = ref('')
const storageUnit    = ref('gb')
const storageSaving  = ref(false)
const storageError   = ref('')
const storageSuccess = ref(false)

watch(
  () => data?.value?.production?.allocatedStorage,
  (bytes) => {
    if (!bytes) { storageInput.value = ''; storageUnit.value = 'gb'; return }
    if (bytes >= UNITS.gb) {
      storageUnit.value  = 'gb'
      storageInput.value = String(bytes / UNITS.gb)
    } else {
      storageUnit.value  = 'mb'
      storageInput.value = String(Math.round(bytes / UNITS.mb))
    }
  },
  { immediate: true },
)

const storageBytes = computed(() => {
  const n = parseFloat(storageInput.value)
  if (!storageInput.value || isNaN(n) || n <= 0) return null
  return Math.round(n * UNITS[storageUnit.value])
})

const storageChanged = computed(() =>
  storageBytes.value !== (data.value?.production?.allocatedStorage ?? null),
)

async function saveStorage() {
  if (!storageChanged.value) return
  storageSaving.value  = true
  storageError.value   = ''
  storageSuccess.value = false
  const { ok, data: resData, error } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}`,
    { method: 'PATCH', json: { allocatedStorage: storageBytes.value }, silent: true },
  )
  storageSaving.value = false
  if (!ok) { storageError.value = error ?? t('settings.failedToSave'); return }
  data.value.production.allocatedStorage = resData.allocatedStorage
  storageSuccess.value = true
  setTimeout(() => { storageSuccess.value = false }, 2000)
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-6 py-8 space-y-6">

    <ProductionProfileEditor
      :upload-url="uploadUrl"
      :profile-image-id="data?.production?.profileImageId"
      :banner-image-id="data?.production?.bannerImageId"
      :banner-src="bannerSrc"
      @uploaded="onUploaded"
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
        <Button size="sm" :disabled="!nameChanged || nameSaving" class="shrink-0 gap-1.5" @click="saveName">
          <Icon v-if="nameSaving" icon="mdi:loading" class="animate-spin" />
          <Icon v-else-if="nameSuccess" icon="mdi:check" />
          {{ nameSaving ? $t('settings.saving') : nameSuccess ? $t('settings.saved') : $t('settings.save') }}
        </Button>
      </div>
      <p v-if="nameError" class="text-xs text-destructive">{{ nameError }}</p>
    </div>

    <div class="border-t border-border" />

    <!-- Storage limit -->
    <div class="space-y-1.5">
      <Label>{{ $t('settings.storageLimit') }}</Label>
      <div class="flex gap-2">
        <Input
          v-model="storageInput"
          type="number"
          min="1"
          step="1"
          :placeholder="$t('settings.noLimit')"
          class="h-9 text-sm"
          @keydown.enter="saveStorage"
        />
        <select
          v-model="storageUnit"
          class="h-9 rounded-md border border-input bg-background px-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="mb">MB</option>
          <option value="gb">GB</option>
        </select>
        <Button size="sm" :disabled="!storageChanged || storageSaving" class="shrink-0 gap-1.5" @click="saveStorage">
          <Icon v-if="storageSaving" icon="mdi:loading" class="animate-spin" />
          <Icon v-else-if="storageSuccess" icon="mdi:check" />
          {{ storageSaving ? $t('settings.saving') : storageSuccess ? $t('settings.saved') : $t('settings.save') }}
        </Button>
      </div>
      <p class="text-xs text-muted-foreground">{{ $t('settings.storageHint') }}</p>
      <p v-if="storageError" class="text-xs text-destructive">{{ storageError }}</p>
    </div>

  </div>
</template>
