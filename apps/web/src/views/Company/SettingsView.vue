<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import Avatar from '@starling/ui/Avatar'
import Image from '@starling/ui/Image'
import ImageCropper from '@starling/ui/ImageCropper'
import Button from '@starling/ui/Button'
import Input from '@starling/ui/Input'
import Label from '@starling/ui/Label'
import { useApi } from '../../composables/useApi.js'
import { useAuth } from '../../composables/useAuth.js'
import { usePageTitle } from '../../composables/usePageTitle.js'
import ConfirmValueDialog from '../../components/ui/ConfirmValueDialog.vue'

const route  = useRoute()
const router = useRouter()
const { t } = useI18n()
const { $fetch } = useApi()
const { user } = useAuth()
const isSiteAdmin = computed(() => user.value?.role === 'admin')

const company  = ref(null)
const loading  = ref(true)
const notFound = ref(false)

usePageTitle(computed(() => company.value ? `${company.value.name} — Settings` : null))

async function load() {
  loading.value = true
  const { ok, data, status } = await $fetch(`/api/company/${route.params.slug}`, { silent: true })
  loading.value = false
  if (status === 404) { notFound.value = true; return }
  if (!ok || !data.canManage) { router.replace(`/c/${route.params.slug}`); return }
  company.value = data
  if (isSiteAdmin.value) loadMembers()
}

onMounted(load)

// ── Profile images ────────────────────────────────────────────────────────────
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

// ── Rename company name ───────────────────────────────────────────────────────
const renameNameOpen    = ref(false)
const newName           = ref('')
const renameNameLoading = ref(false)
const renameNameError   = ref('')

const newNameValid = computed(() => {
  const v = newName.value.trim()
  return v.length > 0 && v !== company.value?.name
})

watch(renameNameOpen, (v) => { if (!v) { newName.value = ''; renameNameError.value = '' } })

async function submitRenameName() {
  renameNameLoading.value = true
  renameNameError.value   = ''
  const { ok, data, error } = await $fetch(
    `/api/company/${route.params.slug}`,
    { method: 'PATCH', json: { name: newName.value.trim() }, silent: true },
  )
  renameNameLoading.value = false
  if (!ok) { renameNameError.value = error ?? 'Failed to rename'; return }
  company.value.name = data.name
  renameNameOpen.value = false
}

// ── Rename company slug ───────────────────────────────────────────────────────
const renameSlugOpen    = ref(false)
const newSlug           = ref('')
const renameSlugLoading = ref(false)
const renameSlugError   = ref('')

const SLUG_RE = /^[a-z0-9-]+$/
const newSlugValid = computed(() => {
  const v = newSlug.value.trim()
  return v.length > 0 && SLUG_RE.test(v) && v !== company.value?.slug
})

watch(renameSlugOpen, (v) => { if (!v) { newSlug.value = ''; renameSlugError.value = '' } })

async function submitRenameSlug() {
  renameSlugLoading.value = true
  renameSlugError.value   = ''
  const { ok, data, error } = await $fetch(
    `/api/company/${route.params.slug}`,
    { method: 'PATCH', json: { slug: newSlug.value.trim() }, silent: true },
  )
  renameSlugLoading.value = false
  if (!ok) { renameSlugError.value = error ?? 'Failed to rename slug'; return }
  renameSlugOpen.value = false
  router.replace(`/c/${data.slug}/settings`)
}

// ── Members management (site admin only) ─────────────────────────────────────
const members        = ref([])
const membersLoading = ref(false)
const membersError   = ref('')

async function loadMembers() {
  membersLoading.value = true
  membersError.value   = ''
  const { ok, data, error } = await $fetch(`/api/company/${route.params.slug}/members`, { silent: true })
  membersLoading.value = false
  if (!ok) { membersError.value = error ?? 'Failed to load members'; return }
  members.value = data.members
}

const addEmail       = ref('')
const addRole        = ref('admin')
const addLoading     = ref(false)
const addError       = ref('')

async function addMember() {
  addLoading.value = true
  addError.value   = ''
  const { ok, data, error } = await $fetch(
    `/api/company/${route.params.slug}/members`,
    { method: 'POST', json: { email: addEmail.value.trim(), role: addRole.value }, silent: true },
  )
  addLoading.value = false
  if (!ok) { addError.value = error ?? 'Failed to add member'; return }
  addEmail.value = ''
  const idx = members.value.findIndex(m => m.id === data.member.id)
  if (idx >= 0) members.value[idx] = { ...members.value[idx], role: data.member.role }
  else await loadMembers()
}

const removingId = ref(null)

async function removeMember(member) {
  removingId.value = member.id
  const { ok, error } = await $fetch(
    `/api/company/${route.params.slug}/members/${member.id}`,
    { method: 'DELETE', silent: true },
  )
  removingId.value = null
  if (!ok) { membersError.value = error ?? 'Failed to remove member'; return }
  members.value = members.value.filter(m => m.id !== member.id)
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

      <!-- Profile / banner images -->
      <div class="relative mb-6">
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

      <div class="border-t border-border pt-6 mb-6">
        <p class="text-base font-semibold">{{ company.name }}</p>
        <p class="text-sm text-muted-foreground font-mono mt-0.5">{{ company.slug }}</p>
      </div>

      <!-- Members (site admin only) -->
      <div v-if="isSiteAdmin" class="rounded-xl border border-border overflow-hidden mb-6">
        <div class="px-5 py-3 bg-muted/40 border-b border-border flex items-center justify-between">
          <p class="text-sm font-semibold">Members</p>
        </div>

        <div v-if="membersLoading" class="px-5 py-4 text-sm text-muted-foreground">Loading…</div>
        <p v-else-if="membersError" class="px-5 py-4 text-sm text-destructive">{{ membersError }}</p>

        <ul v-else class="divide-y divide-border">
          <li
            v-for="m in members"
            :key="m.id"
            class="flex items-center justify-between gap-4 px-5 py-3"
          >
            <div class="min-w-0">
              <p class="text-sm font-medium text-foreground truncate">{{ m.first_name }} {{ m.last_name }}</p>
              <p class="text-xs text-muted-foreground truncate">{{ m.email }}</p>
            </div>
            <div class="flex items-center gap-3 shrink-0">
              <span class="text-xs px-2 py-0.5 rounded-full border"
                :class="{
                  'border-amber-500/40 text-amber-600 bg-amber-50 dark:bg-amber-950/30': m.role === 'owner',
                  'border-blue-500/40 text-blue-600 bg-blue-50 dark:bg-blue-950/30': m.role === 'admin',
                  'border-border text-muted-foreground': m.role === 'member',
                }"
              >{{ m.role }}</span>
              <button
                v-if="m.role !== 'owner'"
                :disabled="removingId === m.id"
                class="text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                @click="removeMember(m)"
              >
                <Icon :icon="removingId === m.id ? 'mdi:loading' : 'mdi:close'" :class="{ 'animate-spin': removingId === m.id }" class="size-4" />
              </button>
            </div>
          </li>
          <li v-if="members.length === 0" class="px-5 py-4 text-sm text-muted-foreground">No members yet.</li>
        </ul>

        <!-- Add member form -->
        <div class="px-5 py-4 border-t border-border flex items-end gap-3">
          <div class="flex-1 flex flex-col gap-1.5">
            <Label for="add-member-email">Add by email</Label>
            <Input
              id="add-member-email"
              v-model="addEmail"
              type="email"
              placeholder="user@example.com"
              autocomplete="off"
              @keydown.enter="addMember"
            />
            <p v-if="addError" class="text-xs text-destructive">{{ addError }}</p>
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="add-member-role">Role</Label>
            <select
              id="add-member-role"
              v-model="addRole"
              class="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="admin">Admin</option>
              <option value="member">Member</option>
            </select>
          </div>
          <Button
            size="sm"
            :disabled="!addEmail.trim() || addLoading"
            class="shrink-0"
            @click="addMember"
          >
            <Icon v-if="addLoading" icon="mdi:loading" class="animate-spin size-4" />
            <span v-else>Add</span>
          </Button>
        </div>
      </div>

      <!-- Danger zone -->
      <div class="rounded-xl border border-destructive/30 overflow-hidden">
        <div class="px-5 py-3 bg-destructive/5 border-b border-destructive/20">
          <p class="text-sm font-semibold text-destructive">Danger zone</p>
        </div>
        <div class="divide-y divide-border">

          <div class="flex items-center justify-between gap-6 px-5 py-4">
            <div class="min-w-0">
              <p class="text-sm font-medium text-foreground">Rename company</p>
              <p class="text-xs text-muted-foreground mt-0.5">Change the display name of this company.</p>
            </div>
            <Button
              size="sm" variant="outline"
              class="shrink-0 border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground"
              @click="renameNameOpen = true"
            >
              Rename
            </Button>
          </div>

          <div class="flex items-center justify-between gap-6 px-5 py-4">
            <div class="min-w-0">
              <p class="text-sm font-medium text-foreground">Rename company slug</p>
              <p class="text-xs text-muted-foreground mt-0.5">Changing the slug will break all existing links to this company and its productions.</p>
            </div>
            <Button
              size="sm" variant="outline"
              class="shrink-0 border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground"
              @click="renameSlugOpen = true"
            >
              Rename slug
            </Button>
          </div>

        </div>
      </div>

    </template>
  </div>

  <!-- Rename name dialog -->
  <ConfirmValueDialog
    :open="renameNameOpen"
    title="Rename company"
    description="Confirm the current name before setting a new one."
    :confirm-value="company?.name ?? ''"
    confirm-label="Rename"
    :loading="renameNameLoading"
    :extra-disabled="!newNameValid"
    @confirm="submitRenameName"
    @cancel="renameNameOpen = false"
  >
    <template #default="{ matches }">
      <div class="flex flex-col gap-1.5">
        <Label for="new-cname">New name</Label>
        <Input
          id="new-cname"
          v-model="newName"
          :disabled="!matches"
          placeholder="Acme Inc."
          autocomplete="off"
        />
        <p v-if="renameNameError" class="text-xs text-destructive">{{ renameNameError }}</p>
      </div>
    </template>
  </ConfirmValueDialog>

  <!-- Rename slug dialog -->
  <ConfirmValueDialog
    :open="renameSlugOpen"
    title="Rename company slug"
    description="Changing the slug will break all existing links to this company and every production under it."
    :confirm-value="company?.slug ?? ''"
    confirm-label="Rename slug"
    :loading="renameSlugLoading"
    :extra-disabled="!newSlugValid"
    @confirm="submitRenameSlug"
    @cancel="renameSlugOpen = false"
  >
    <template #default="{ matches }">
      <div class="flex flex-col gap-1.5">
        <Label for="new-cslug">New slug</Label>
        <Input
          id="new-cslug"
          v-model="newSlug"
          :disabled="!matches"
          placeholder="acme-inc"
          autocomplete="off"
        />
        <p class="text-xs text-muted-foreground">Lowercase letters, numbers, and hyphens only.</p>
        <p v-if="renameSlugError" class="text-xs text-destructive">{{ renameSlugError }}</p>
      </div>
    </template>
  </ConfirmValueDialog>

</template>
