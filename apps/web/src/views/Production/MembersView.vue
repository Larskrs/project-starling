<script setup>
import { ref, inject, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { ConfirmDialog, Input } from '@starling/ui'
import { useApi }  from '../../composables/useApi'
import { useAuth } from '../../composables/useAuth'
import RoleSelector from './components/RoleSelector.vue'
import MemberRow   from './components/MemberRow.vue'
import ListCard    from '@starling/ui/ListCard'
import ListHeader  from '@starling/ui/ListHeader'
import { Skeleton, Spinner } from '@starling/ui'

const { t }      = useI18n()
const { $fetch } = useApi()
const { user }   = useAuth()
const production = inject('production-data')
const pid        = computed(() => production.value?.production?.id)

// ── Roles ─────────────────────────────────────────────────────────────────────
const roles = ref([])

async function loadRoles() {
  const { ok, data } = await $fetch(
    `/api/production/${pid.value}/roles`,
    { silent: true },
  )
  if (ok) roles.value = data.map(r => ({ ...r, permissions: BigInt(r.permissions) }))
}

// ── Members ───────────────────────────────────────────────────────────────────
const members        = ref([])
const search         = ref('')
const searchFiltered = ref([])
const loading        = ref(false)
const error          = ref('')

watch([search, members], ([s]) => {
  const q = s.trim().toLowerCase()
  if (!q) { searchFiltered.value = members.value; return }
  searchFiltered.value = members.value.filter((m) => {
    const name  = (m.user.firstName ? `${m.user.firstName} ${m.user.lastName ?? ''}` : m.user.name) || ''
    return name.toLowerCase().includes(q) || (m.user.email || '').toLowerCase().includes(q)
  })
})

async function loadMembers() {
  loading.value = true
  error.value   = ''
  const { ok, data } = await $fetch(
    `/api/production/${pid.value}/members`,
    { silent: true },
  )
  loading.value = false
  if (!ok) { error.value = t('members.couldNotLoad'); return }
  members.value = data
}

onMounted(() => { loadRoles(); loadMembers(); loadInvites() })

// ── Add member ────────────────────────────────────────────────────────────────
const addEmail  = ref('')
const addRoleId = ref('')
const addSaving = ref(false)
const addError  = ref('')

const addNotice = ref('')

async function addMember() {
  if (!addEmail.value.trim()) return
  addSaving.value = true
  addError.value  = ''
  addNotice.value = ''
  const body = { email: addEmail.value.trim() }
  if (addRoleId.value) body.roleId = addRoleId.value
  const { ok, data, error: fetchError } = await $fetch(
    `/api/production/${pid.value}/members`,
    { method: 'POST', json: body, silent: true },
  )
  addSaving.value = false
  if (!ok) { addError.value = fetchError ?? t('members.failedToAdd'); return }

  // No account on that address: the API mailed them a one-time invite instead
  // of adding a member, so there is nothing new in the members list to show.
  if (data?.invited) {
    addNotice.value = t('members.inviteSent', { email: data.email })
    addEmail.value  = ''
    addRoleId.value = ''
    await loadInvites()
    return
  }

  addEmail.value  = ''
  addRoleId.value = ''
  await loadMembers()
}

// ── Invite links ──────────────────────────────────────────────────────────────

const invites      = ref([])
const linkRoleId   = ref('')
const linkCreating = ref(false)
const createdLink  = ref('')
const linkCopied   = ref(false)

async function loadInvites() {
  const { ok, data } = await $fetch(`/api/production/${pid.value}/invites`, { silent: true })
  if (ok) invites.value = data
}

async function createInviteLink() {
  linkCreating.value = true
  createdLink.value  = ''
  linkCopied.value   = false
  const body = linkRoleId.value ? { roleId: linkRoleId.value } : {}
  const { ok, data } = await $fetch(
    `/api/production/${pid.value}/invites`,
    { method: 'POST', json: body },
  )
  linkCreating.value = false
  if (!ok) return

  // Shown once — the server keeps only a hash, so this is the only chance to
  // copy it. A fresh link is one click away if they lose it.
  createdLink.value = data.url
  await loadInvites()
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(createdLink.value)
    linkCopied.value = true
  } catch {
    linkCopied.value = false
  }
}

async function revokeInvite(invite) {
  const { ok } = await $fetch(
    `/api/production/${pid.value}/invites/${invite.id}`,
    { method: 'DELETE' },
  )
  if (ok) invites.value = invites.value.filter(i => i.id !== invite.id)
}

/** "in 42 minutes" / "in 6 days" — invites are short-lived, so this is coarse. */
function expiresIn(invite) {
  const minutes = Math.max(0, Math.round((new Date(invite.expiresAt) - Date.now()) / 60000))
  if (minutes < 90)   return t('members.expiresMinutes', { minutes })
  if (minutes < 2880) return t('members.expiresHours',   { hours: Math.round(minutes / 60) })
  return t('members.expiresDays', { days: Math.round(minutes / 1440) })
}

async function changeMemberRole(member, roleId) {
  const { ok } = await $fetch(
    `/api/production/${pid.value}/members/${member.id}`,
    { method: 'PATCH', json: { roleId: roleId || null } },
  )
  if (ok) await loadMembers()
}

/**
 * Removing a member goes through the app's own ConfirmDialog rather than the
 * browser's confirm(). Native confirm ignores the theme, blocks the main
 * thread, and gives a destructive action no visual weight — and once a user
 * ticks "prevent this page from creating additional dialogs" it returns false
 * forever, so the removal would silently stop working.
 */
const removeTarget = ref(null)
const removing = ref(false)

const removeName = computed(() =>
  removeTarget.value
    ? removeTarget.value.user.firstName || removeTarget.value.user.name
    : '',
)

async function removeMember() {
  const member = removeTarget.value
  if (!member) return
  removing.value = true
  const { ok } = await $fetch(
    `/api/production/${pid.value}/members/${member.id}`,
    { method: 'DELETE' },
  )
  removing.value = false
  removeTarget.value = null
  if (ok) members.value = members.value.filter(m => m.id !== member.id)
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-6 py-8 flex flex-col gap-5">

    <!-- Add member -->
    <section class="rounded-xl border border-border bg-card px-5 py-4 flex flex-col gap-3">
      <p class="text-sm font-medium">{{ $t('members.addMember') }}</p>
      <div class="flex gap-2">
        <input
          v-model="addEmail"
          type="email"
          :placeholder="$t('members.emailPlaceholder')"
          class="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          @keydown.enter="addMember"
        />
        <RoleSelector v-model="addRoleId" :roles="roles" align="start" />
        <button
          class="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5 shrink-0"
          :disabled="!addEmail.trim() || addSaving"
          @click="addMember"
        >
          <Spinner v-if="addSaving" class="text-sm" />
          {{ $t('members.add') }}
        </button>
      </div>
      <p v-if="addError" class="text-xs text-destructive">{{ addError }}</p>
      <p v-if="addNotice" class="text-xs text-muted-foreground">{{ addNotice }}</p>
    </section>

    <!-- Invite link -->
    <section class="rounded-xl border border-border bg-card px-5 py-4 flex flex-col gap-3">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-sm font-medium">{{ $t('members.inviteLink') }}</p>
          <p class="text-xs text-muted-foreground mt-0.5">{{ $t('members.inviteLinkHint') }}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <RoleSelector v-model="linkRoleId" :roles="roles" align="end" />
          <button
            class="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
            :disabled="linkCreating"
            @click="createInviteLink"
          >
            <Spinner v-if="linkCreating" class="text-sm" />
            {{ $t('members.createLink') }}
          </button>
        </div>
      </div>

      <!-- Shown once: only a hash is stored, so this is the only chance to copy it. -->
      <div v-if="createdLink" class="flex items-center gap-2">
        <input
          :value="createdLink"
          readonly
          class="flex-1 h-9 rounded-md border border-input bg-muted px-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
          @focus="$event.target.select()"
        />
        <button
          class="h-9 px-3 rounded-md border border-border text-sm hover:bg-muted transition-colors shrink-0"
          @click="copyLink"
        >{{ linkCopied ? $t('members.copied') : $t('members.copy') }}</button>
      </div>

      <!-- Pending invites -->
      <ul v-if="invites.length" class="divide-y divide-border border-t border-border -mx-5 px-5">
        <li v-for="invite in invites" :key="invite.id" class="flex items-center gap-3 py-2.5">
          <Icon :icon="invite.email ? 'mdi:email-outline' : 'mdi:link-variant'" class="text-muted-foreground shrink-0" />
          <div class="flex-1 min-w-0">
            <p class="text-sm truncate">{{ invite.email || $t('members.anyoneWithLink') }}</p>
            <p class="text-xs text-muted-foreground">
              {{ expiresIn(invite) }}
              <template v-if="invite.roleName"> · {{ invite.roleName }}</template>
              <template v-if="invite.maxUses"> · {{ $t('members.usesOf', { used: invite.useCount, max: invite.maxUses }) }}</template>
            </p>
          </div>
          <button
            type="button"
            class="p-1.5 rounded text-muted-foreground/50 hover:text-destructive transition-colors shrink-0"
            :title="$t('members.revokeInvite')"
            :aria-label="$t('members.revokeInvite')"
            @click="revokeInvite(invite)"
          >
            <Icon icon="mdi:close" class="text-sm" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </section>

    <!-- Members list -->
    <ListCard>

      <ListHeader :title="$t('members.title')">
        <template #action>
          <span
            v-if="!loading && members.length"
            class="text-xs tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md"
          >{{ members.length }}</span>
        </template>
      </ListHeader>

      <ul v-if="loading" class="divide-y divide-border">
        <li v-for="i in 5" :key="i" class="flex items-center gap-3 px-5 py-3">
          <Skeleton class="size-8 rounded-full shrink-0" />
          <div class="flex-1 flex flex-col gap-1.5">
            <Skeleton class="h-3.5 rounded" :style="{ width: `${[9,7,8,6,9][i-1] * 12}px` }" />
            <Skeleton class="h-3 w-40 rounded" />
          </div>
          <Skeleton class="h-7 w-20 rounded-md shrink-0" />
        </li>
      </ul>
      <p v-else-if="error" class="px-5 py-4 text-sm text-destructive">{{ error }}</p>
      <div v-else-if="!members.length" class="py-14 text-center text-sm text-muted-foreground">
        {{ $t('members.noMembers') }}
      </div>

      <ul v-else class="divide-y divide-border">
        <div class="relative px-5 py-3">
          <div class="relative">
            <Input class="pl-9" :placeholder="$t('members.search')" v-model="search" />
            <Icon icon="mdi:search" class="absolute left-3 top-1/2 -translate-y-1/2" />
          </div>
        </div>
        <MemberRow
          v-for="member in searchFiltered"
          :key="member.id"
          :member="member"
          :is-self="member.user.id === user?.id"
        >
          <div :class="member.user.id === user?.id ? 'opacity-40 pointer-events-none' : ''">
            <RoleSelector
              :model-value="member.role?.id ?? null"
              :roles="roles"
              @update:model-value="changeMemberRole(member, $event)"
            />
          </div>
          <button
            v-if="member.user.id !== user?.id"
            type="button"
            class="p-1.5 rounded text-muted-foreground/50 hover:text-destructive transition-colors shrink-0
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                   focus-visible:ring-offset-2 ring-offset-background"
            :title="$t('members.removeTitle')"
            :aria-label="$t('members.confirmRemove', { name: member.user.firstName || member.user.name })"
            @click="removeTarget = member"
          >
            <Icon icon="mdi:close" class="text-sm" aria-hidden="true" />
          </button>
          <div v-else class="size-7 shrink-0" />
        </MemberRow>
      </ul>

    </ListCard>

    <ConfirmDialog
      :open="removeTarget !== null"
      :title="$t('members.removeTitle')"
      :confirm-label="$t('members.removeTitle')"
      :cancel-label="$t('storage.cancel')"
      :loading="removing"
      destructive
      @confirm="removeMember"
      @cancel="removeTarget = null"
    >
      {{ $t('members.confirmRemove', { name: removeName }) }}
    </ConfirmDialog>

  </div>
</template>
