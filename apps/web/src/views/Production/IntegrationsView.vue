<script setup>
import { inject, ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Avatar, Button, Skeleton, Spinner, ConfirmDialog, EmptyState, useToast } from '@starling/ui'
import ImageCropper from '@starling/ui/ImageCropper'
import { useApi } from '../../composables/useApi'
import NewTokenDialog from './components/NewTokenDialog.vue'
import { expiryState, lastUsedLabel, permissionKey } from './lib/tokenFormat'

// Mirrors TOKEN_FORBIDDEN_PERMISSIONS on the server: MANAGE_MEMBERS (bit 3),
// MANAGE_ROLES (bit 4), ADMINISTRATOR (bit 5).
//
// Every role is offered. These bits are stripped from whichever one is chosen,
// and the form names them before the token is created — most productions run a
// single broad role, so hiding those roles left the page with an empty dropdown
// and no way forward. What matters is that the stripping is never silent.
// `key` matches the camelCase naming the roles page already uses for permission
// labels, so the two pages never call the same permission different things.
const FORBIDDEN = [
  { bit: 1n << 3n, key: 'manageMembers' },
  { bit: 1n << 4n, key: 'manageRoles' },
  { bit: 1n << 5n, key: 'administrator' },
]

function withheldFor(role) {
  if (!role) return []
  const bits = BigInt(role.permissions)
  return FORBIDDEN.filter(f => (bits & f.bit) !== 0n).map(f => f.key)
}

const data  = inject('production-data')
const { t } = useI18n()
const { $fetch } = useApi()
const toast = useToast()

const productionId = computed(() => data.value?.production?.id)
const base = computed(() => `/api/production/${productionId.value}/tokens`)

const tokens  = ref([])
const roles   = ref([])
const events  = ref([])
const ttlDays = ref(30)
const loading = ref(true)
const error   = ref('')

// Recomputed on every load rather than held as reactive state: an expiry that
// silently goes stale while the tab sits open is exactly the thing this page is
// supposed to warn about.
function decorate(token) {
  return { ...token, expiry: expiryState(token.expiresAt), lastUsed: lastUsedLabel(token.lastUsedAt) }
}

async function load() {
  loading.value = true
  error.value   = ''

  const [tokenRes, roleRes, eventRes] = await Promise.all([
    $fetch(base.value, { silent: true }),
    $fetch(`/api/production/${productionId.value}/roles`, { silent: true }),
    $fetch(`${base.value}/events?limit=30`, { silent: true }),
  ])

  loading.value = false
  if (!tokenRes.ok) { error.value = t('integrations.couldNotLoad'); return }

  tokens.value  = (tokenRes.data.tokens ?? []).map(decorate)
  ttlDays.value = tokenRes.data.ttlDays ?? 30
  events.value  = eventRes.ok ? (eventRes.data.events ?? []) : []

  roles.value = roleRes.ok ? (roleRes.data ?? []) : []
}

onMounted(load)

// ── Creating ──────────────────────────────────────────────────────────────────
const newLabel  = ref('')
const newRoleId = ref('')
const creating  = ref(false)

const canCreate = computed(() => newLabel.value.trim().length > 0 && !!newRoleId.value && !creating.value)

const selectedRole     = computed(() => roles.value.find(r => r.id === newRoleId.value) ?? null)
const selectedWithheld = computed(() => withheldFor(selectedRole.value))

const secretDialog = ref({ open: false, secret: '', label: '' })

async function createToken() {
  if (!canCreate.value) return
  creating.value = true

  const { ok, data: res, error: err } = await $fetch(base.value, {
    method: 'POST',
    json:   { label: newLabel.value.trim(), roleId: newRoleId.value },
    silent: true,
  })
  creating.value = false
  if (!ok) { toast.error(err ?? t('integrations.failedToCreate')); return }

  tokens.value = [decorate(res.token), ...tokens.value]
  // Opened before clearing the form, so the secret is on screen the instant the
  // request returns — this is the only time it exists.
  secretDialog.value = { open: true, secret: res.secret, label: res.token.label }
  newLabel.value  = ''
  newRoleId.value = ''
  void refreshEvents()
}

// ── Revoking ──────────────────────────────────────────────────────────────────
const revoking = ref(null)
const pendingRevoke = ref(null)

async function confirmRevoke() {
  const token = pendingRevoke.value
  if (!token) return
  revoking.value = token.id

  const { ok, error: err } = await $fetch(`${base.value}/${token.id}`, { method: 'DELETE', silent: true })
  revoking.value = null
  pendingRevoke.value = null
  if (!ok) { toast.error(err ?? t('integrations.failedToRevoke')); return }

  tokens.value = tokens.value.filter(x => x.id !== token.id)
  toast.success(t('integrations.revoked', { label: token.label }))
  void refreshEvents()
}

// ── Profile image ─────────────────────────────────────────────────────────────
// Picked per row, cropped square, then uploaded; the device shows as this image
// wherever it appears in presence.
const cropFile       = ref(null)
const cropToken      = ref(null)
const uploadingImage = ref(null)

function onImagePick(token, e) {
  const f = e.target.files?.[0]
  if (f) { cropFile.value = f; cropToken.value = token }
  e.target.value = ''
}

function onCropCancel() {
  cropFile.value  = null
  cropToken.value = null
}

async function onCropped(blob) {
  const token = cropToken.value
  onCropCancel()
  if (!token) return
  uploadingImage.value = token.id

  const fd = new FormData()
  fd.append('file', new File([blob], 'image.jpg', { type: 'image/jpeg' }))
  const { ok, data: res, error: err } = await $fetch(`${base.value}/${token.id}/profile`, {
    method: 'POST', body: fd, silent: true,
  })
  uploadingImage.value = null
  if (!ok) { toast.error(err ?? t('integrations.imageUploadFailed')); return }

  tokens.value = tokens.value.map(x => x.id === token.id ? { ...x, profileImageId: res.fileId } : x)
}

async function refreshEvents() {
  const { ok, data: res } = await $fetch(`${base.value}/events?limit=30`, { silent: true })
  if (ok) events.value = res.events ?? []
}

const EVENT_ICONS = {
  issued:   'mdi:key-plus',
  revoked:  'mdi:key-remove',
  rejected: 'mdi:shield-alert-outline',
  create:   'mdi:plus',
  update:   'mdi:pencil-outline',
  delete:   'mdi:trash-can-outline',
}

function formatTime(iso) {
  return new Date(iso).toLocaleString()
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-6 py-8 space-y-8">

    <div>
      <h2 class="text-lg font-semibold text-foreground mb-1">{{ $t('integrations.title') }}</h2>
      <p class="text-sm text-muted-foreground">
        {{ $t('integrations.description', { days: ttlDays }) }}
        <a href="/docs/integrations" target="_blank" rel="noopener" class="underline underline-offset-2 hover:text-foreground">
          {{ $t('integrations.readTheGuide') }}
        </a>
      </p>
    </div>

    <!-- Create -->
    <div class="rounded-xl border border-border p-4 space-y-3">
      <p class="text-sm font-medium text-foreground">{{ $t('integrations.newToken') }}</p>
      <div class="flex flex-col sm:flex-row gap-2">
        <input
          v-model="newLabel"
          type="text"
          maxlength="64"
          :placeholder="$t('integrations.labelPlaceholder')"
          class="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          @keydown.enter="createToken"
        />
        <select
          v-model="newRoleId"
          class="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="" disabled>{{ $t('integrations.choseRole') }}</option>
          <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option>
        </select>
        <Button type="button" :disabled="!canCreate" class="gap-1.5" @click="createToken">
          <Spinner v-if="creating" />
          {{ $t('integrations.create') }}
        </Button>
      </div>
      <div
        v-if="selectedWithheld.length"
        class="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2.5"
      >
        <Icon icon="mdi:shield-off-outline" class="size-4 shrink-0 mt-0.5 text-muted-foreground" />
        <p class="text-xs leading-relaxed text-muted-foreground">
          {{ $t('integrations.withheldNotice', { permissions: selectedWithheld.map(p => $t(`roles.permissions.${p}`)).join(', ') }) }}
        </p>
      </div>

      <p v-if="roles.length === 0 && !loading" class="text-xs text-muted-foreground">
        {{ $t('integrations.noRoles') }}
      </p>
    </div>

    <!-- Tokens -->
    <div class="space-y-3">
      <ul v-if="loading" class="space-y-3">
        <li v-for="i in 2" :key="i" class="rounded-xl border border-border px-5 py-4 flex items-center gap-4">
          <Skeleton class="size-8 rounded-lg shrink-0" />
          <div class="flex-1 space-y-2">
            <Skeleton class="h-4 w-40 rounded" />
            <Skeleton class="h-3 w-64 rounded" />
          </div>
        </li>
      </ul>

      <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>

      <EmptyState v-else-if="tokens.length === 0" icon="mdi:transit-connection-variant" bordered>
        {{ $t('integrations.noTokens') }}
      </EmptyState>

      <ul v-else class="space-y-3">
        <li
          v-for="token in tokens"
          :key="token.id"
          class="rounded-xl border border-border px-5 py-4 flex items-start gap-4"
        >
          <!-- Profile image: click to pick, crop and upload -->
          <label
            class="relative size-8 shrink-0 cursor-pointer group"
            :title="$t('integrations.changeImage')"
          >
            <Avatar :id="token.profileImageId" :alt="token.label" class="size-8 rounded-lg bg-muted">
              <Icon icon="mdi:transit-connection-variant" class="size-4.5 text-muted-foreground" />
            </Avatar>
            <div
              class="absolute inset-0 rounded-lg flex items-center justify-center transition-colors"
              :class="uploadingImage === token.id ? 'bg-black/45' : 'bg-black/0 group-hover:bg-black/45'"
            >
              <Icon
                :icon="uploadingImage === token.id ? 'mdi:loading' : 'mdi:camera-outline'"
                class="size-3.5 text-white transition-opacity"
                :class="uploadingImage === token.id ? 'animate-spin opacity-100' : 'opacity-0 group-hover:opacity-100'"
              />
            </div>
            <input
              type="file"
              accept="image/*"
              class="sr-only"
              :disabled="uploadingImage === token.id"
              @change="onImagePick(token, $event)"
            />
          </label>

          <div class="flex-1 min-w-0 space-y-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-medium text-foreground truncate">{{ token.label }}</span>
              <span
                v-if="token.roleName"
                class="text-[11px] px-1.5 py-0.5 rounded-full border"
                :style="{
                  color: `oklch(55% 0.15 ${token.roleHue})`,
                  borderColor: `oklch(55% 0.15 ${token.roleHue} / 0.4)`,
                }"
              >{{ token.roleName }}</span>
              <span v-else class="text-[11px] px-1.5 py-0.5 rounded-full border border-destructive/40 text-destructive">
                {{ $t('integrations.roleDeleted') }}
              </span>
              <!-- Without this the row would read as "Administrator" and imply
                   powers the token was never given. -->
              <span
                v-if="token.withheld?.length"
                class="text-[11px] px-1.5 py-0.5 rounded-full border border-border text-muted-foreground"
                :title="$t('integrations.withheldNotice', {
                  permissions: token.withheld.map(p => $t(`roles.permissions.${permissionKey(p)}`)).join(', '),
                })"
              >{{ $t('integrations.limited') }}</span>
            </div>

            <div class="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span
                :class="{
                  'text-destructive': token.expiry.tone === 'expired',
                  'text-amber-600 dark:text-amber-500': token.expiry.tone === 'soon',
                }"
              >
                <template v-if="token.expiry.tone === 'expired'">{{ $t('integrations.expired') }}</template>
                <template v-else>{{ $t('integrations.expiresIn', { days: token.expiry.days }) }}</template>
              </span>
              <span>·</span>
              <span v-if="token.lastUsed">{{ $t('integrations.lastUsed', { when: token.lastUsed }) }}</span>
              <span v-else class="text-amber-600 dark:text-amber-500">{{ $t('integrations.neverUsed') }}</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            :disabled="revoking === token.id"
            @click="pendingRevoke = token"
          >
            <Spinner v-if="revoking === token.id" />
            {{ $t('integrations.revoke') }}
          </Button>
        </li>
      </ul>
    </div>

    <!-- Audit -->
    <div v-if="events.length" class="space-y-3">
      <div>
        <h3 class="text-sm font-semibold text-foreground">{{ $t('integrations.activity') }}</h3>
        <p class="text-xs text-muted-foreground">{{ $t('integrations.activityHint') }}</p>
      </div>
      <ul class="rounded-xl border border-border divide-y divide-border overflow-hidden">
        <li v-for="entry in events" :key="entry.id" class="flex items-center gap-3 px-4 py-2.5">
          <Icon
            :icon="EVENT_ICONS[entry.event] ?? 'mdi:circle-small'"
            class="size-4 shrink-0"
            :class="entry.event === 'rejected' ? 'text-destructive' : 'text-muted-foreground'"
          />
          <div class="flex-1 min-w-0">
            <p class="text-xs text-foreground truncate">
              <span class="font-medium">{{ entry.tokenLabel ?? $t('integrations.unknownToken') }}</span>
              <span class="text-muted-foreground"> — {{ entry.detail ?? entry.event }}</span>
            </p>
            <p v-if="entry.actorName || entry.ip" class="text-[11px] text-muted-foreground truncate">
              <span v-if="entry.actorName">{{ entry.actorName }}</span>
              <span v-if="entry.actorName && entry.ip"> · </span>
              <span v-if="entry.ip">{{ entry.ip }}</span>
            </p>
          </div>
          <span class="text-[11px] text-muted-foreground shrink-0">{{ formatTime(entry.occurredAt) }}</span>
        </li>
      </ul>
    </div>

    <ImageCropper
      :file="cropFile"
      :aspect-ratio="1"
      :max-output="600"
      @crop="onCropped"
      @cancel="onCropCancel"
    />

    <NewTokenDialog
      :open="secretDialog.open"
      :secret="secretDialog.secret"
      :label="secretDialog.label"
      @close="secretDialog = { open: false, secret: '', label: '' }"
    />

    <ConfirmDialog
      :open="!!pendingRevoke"
      :title="$t('integrations.revokeTitle', { label: pendingRevoke?.label ?? '' })"
      :confirm-label="$t('integrations.revoke')"
      :cancel-label="$t('common.cancel')"
      :loading="!!revoking"
      destructive
      @confirm="confirmRevoke"
      @cancel="pendingRevoke = null"
    >
      {{ $t('integrations.revokeWarning') }}
    </ConfirmDialog>

  </div>
</template>
