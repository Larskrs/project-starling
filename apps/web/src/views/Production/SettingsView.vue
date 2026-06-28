<script setup>
import { inject, ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import Button from '@starling/ui/Button'
import Input from '@starling/ui/Input'
import Label from '@starling/ui/Label'
import { useApi } from '../../composables/useApi.js'
import ProductionProfileEditor from './components/ProductionProfileEditor.vue'
import ConfirmValueDialog from '../../components/ui/ConfirmValueDialog.vue'

const route  = useRoute()
const router = useRouter()
const data   = inject('production-data')
const { t }  = useI18n()
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

// ── Rename slug ───────────────────────────────────────────────────────────────
const renameSlugOpen    = ref(false)
const newSlug           = ref('')
const renameSlugLoading = ref(false)
const renameSlugError   = ref('')

const SLUG_RE = /^[a-z0-9-]+$/
const newSlugValid = computed(() => {
  const v = newSlug.value.trim()
  return v.length > 0 && SLUG_RE.test(v) && v !== data.value?.production?.slug
})

watch(renameSlugOpen, (v) => { if (!v) { newSlug.value = ''; renameSlugError.value = '' } })

async function submitRenameSlug() {
  renameSlugLoading.value = true
  renameSlugError.value   = ''
  const { ok, data: resData, error } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}`,
    { method: 'PATCH', json: { slug: newSlug.value.trim() }, silent: true },
  )
  renameSlugLoading.value = false
  if (!ok) { renameSlugError.value = error ?? t('danger.failedToRenameSlug'); return }
  renameSlugOpen.value = false
  router.replace(`/c/${route.params.cslug}/p/${resData.slug}/settings`)
}

// ── Delete production ─────────────────────────────────────────────────────────
const deleteOpen    = ref(false)
const deleteLoading = ref(false)
const deleteError   = ref('')

watch(deleteOpen, (v) => { if (!v) deleteError.value = '' })

async function submitDelete() {
  deleteLoading.value = true
  deleteError.value   = ''
  const { ok, error } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}`,
    { method: 'DELETE', silent: true },
  )
  deleteLoading.value = false
  if (!ok) { deleteError.value = error ?? t('danger.failedToDeleteProduction'); return }
  deleteOpen.value = false
  router.replace(`/c/${route.params.cslug}`)
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

    <div class="border-t border-border" />

    <!-- Danger zone -->
    <div class="rounded-xl border border-destructive/30 overflow-hidden">
      <div class="px-5 py-3 bg-destructive/5 border-b border-destructive/20">
        <p class="text-sm font-semibold text-destructive">{{ $t('danger.zone') }}</p>
      </div>
      <div class="divide-y divide-border">

        <div class="flex items-center justify-between gap-6 px-5 py-4">
          <div class="min-w-0">
            <p class="text-sm font-medium text-foreground">{{ $t('danger.renameProductionSlug') }}</p>
            <p class="text-xs text-muted-foreground mt-0.5">{{ $t('danger.renameProductionSlugDesc') }}</p>
          </div>
          <Button
            size="sm" variant="outline"
            class="shrink-0 border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground"
            @click="renameSlugOpen = true"
          >
            {{ $t('danger.renameSlugLabel') }}
          </Button>
        </div>

        <div class="flex items-center justify-between gap-6 px-5 py-4">
          <div class="min-w-0">
            <p class="text-sm font-medium text-foreground">{{ $t('danger.deleteProduction') }}</p>
            <p class="text-xs text-muted-foreground mt-0.5">{{ $t('danger.deleteProductionDesc') }}</p>
          </div>
          <Button size="sm" variant="destructive" class="shrink-0" @click="deleteOpen = true">
            {{ $t('danger.deleteProduction') }}
          </Button>
        </div>

      </div>
    </div>

  </div>

  <!-- Rename slug dialog -->
  <ConfirmValueDialog
    :open="renameSlugOpen"
    title="Rename production slug"
    description="Changing the slug will break all existing links to this production. Make sure to update any bookmarks or integrations."
    :confirm-value="data?.production?.slug ?? ''"
    confirm-label="Rename slug"
    :loading="renameSlugLoading"
    :extra-disabled="!newSlugValid"
    @confirm="submitRenameSlug"
    @cancel="renameSlugOpen = false"
  >
    <template #default="{ matches }">
      <div class="flex flex-col gap-1.5">
        <Label for="new-pslug">New slug</Label>
        <Input
          id="new-pslug"
          v-model="newSlug"
          :disabled="!matches"
          placeholder="new-slug"
          autocomplete="off"
        />
        <p class="text-xs text-muted-foreground">Lowercase letters, numbers, and hyphens only.</p>
        <p v-if="renameSlugError" class="text-xs text-destructive">{{ renameSlugError }}</p>
      </div>
    </template>
  </ConfirmValueDialog>

  <!-- Delete dialog -->
  <ConfirmValueDialog
    :open="deleteOpen"
    title="Delete production"
    description="This will permanently delete the production and all its files, folders, members, and roles. There is no going back."
    :confirm-value="data?.production?.slug ?? ''"
    confirm-label="Delete production"
    :loading="deleteLoading"
    @confirm="submitDelete"
    @cancel="deleteOpen = false"
  >
    <template v-if="deleteError" #default>
      <p class="text-xs text-destructive">{{ deleteError }}</p>
    </template>
  </ConfirmValueDialog>

</template>
