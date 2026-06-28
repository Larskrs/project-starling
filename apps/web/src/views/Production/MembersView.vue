<script setup>
import { ref, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { Icon } from '@iconify/vue'
import { Input } from '@starling/ui'
import { useApi }  from '../../composables/useApi.js'
import { useAuth } from '../../composables/useAuth.js'
import RoleSelector from './components/RoleSelector.vue'
import MemberRow   from './components/MemberRow.vue'
import ListCard    from '@starling/ui/ListCard'
import ListHeader  from '@starling/ui/ListHeader'

const route      = useRoute()
const { t }      = useI18n()
const { $fetch } = useApi()
const { user }   = useAuth()

// ── Roles ─────────────────────────────────────────────────────────────────────
const roles = ref([])

async function loadRoles() {
  const { ok, data } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/roles`,
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
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/members`,
    { silent: true },
  )
  loading.value = false
  if (!ok) { error.value = t('members.couldNotLoad'); return }
  members.value = data
}

onMounted(() => { loadRoles(); loadMembers() })

// ── Add member ────────────────────────────────────────────────────────────────
const addEmail  = ref('')
const addRoleId = ref('')
const addSaving = ref(false)
const addError  = ref('')

async function addMember() {
  if (!addEmail.value.trim()) return
  addSaving.value = true
  addError.value  = ''
  const body = { email: addEmail.value.trim() }
  if (addRoleId.value) body.roleId = addRoleId.value
  const { ok, error: fetchError } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/members`,
    { method: 'POST', json: body, silent: true },
  )
  addSaving.value = false
  if (!ok) { addError.value = fetchError ?? t('members.failedToAdd'); return }
  addEmail.value  = ''
  addRoleId.value = ''
  await loadMembers()
}

async function changeMemberRole(member, roleId) {
  const { ok } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/members/${member.id}`,
    { method: 'PATCH', json: { roleId: roleId || null } },
  )
  if (ok) await loadMembers()
}

async function removeMember(member) {
  const name = member.user.firstName || member.user.name
  if (!confirm(t('members.confirmRemove', { name }))) return
  const { ok } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/members/${member.id}`,
    { method: 'DELETE' },
  )
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
          <Icon v-if="addSaving" icon="mdi:loading" class="animate-spin text-sm" />
          {{ $t('members.add') }}
        </button>
      </div>
      <p v-if="addError" class="text-xs text-destructive">{{ addError }}</p>
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

      <div v-if="loading" class="flex items-center justify-center py-14">
        <Icon icon="mdi:loading" class="animate-spin text-xl text-muted-foreground/50" />
      </div>
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
            class="p-1.5 rounded text-muted-foreground/50 hover:text-destructive transition-colors shrink-0"
            :title="$t('members.removeTitle')"
            @click="removeMember(member)"
          >
            <Icon icon="mdi:close" class="text-sm" />
          </button>
          <div v-else class="size-7 shrink-0" />
        </MemberRow>
      </ul>

    </ListCard>

  </div>
</template>
