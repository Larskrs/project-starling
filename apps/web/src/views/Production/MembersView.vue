<script setup>
import { inject, ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Icon } from '@iconify/vue'
import { useApi } from '../../composables/useApi.js'

const route = useRoute()
const data  = inject('production-data')
const { $fetch } = useApi()

// ── Roles (needed for role selector + badges) ─────────────────────────────────
const roles = ref([])

async function loadRoles() {
  const { ok, data: resData } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/roles`,
    { silent: true },
  )
  if (ok) roles.value = resData.map(r => ({ ...r, permissions: BigInt(r.permissions) }))
}

// ── Members ───────────────────────────────────────────────────────────────────
const members = ref([])
const loading = ref(false)
const error   = ref('')

async function loadMembers() {
  loading.value = true
  error.value   = ''
  const { ok, data: resData } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/members`,
    { silent: true },
  )
  loading.value = false
  if (!ok) { error.value = 'Could not load members'; return }
  members.value = resData
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
  const { ok, error } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/members`,
    { method: 'POST', json: body, silent: true },
  )
  addSaving.value = false
  if (!ok) { addError.value = error ?? 'Failed to add member'; return }
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
  if (!confirm(`Remove ${name} from this production?`)) return
  const { ok } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/members/${member.id}`,
    { method: 'DELETE' },
  )
  if (ok) members.value = members.value.filter(m => m.id !== member.id)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function roleBadgeStyle(hue) {
  return {
    backgroundColor: `oklch(65% 0.18 ${hue} / 0.15)`,
    color:           `oklch(60% 0.2 ${hue})`,
  }
}

function resolvedRole(member) {
  return member.role ? (roles.value.find(r => r.id === member.role.id) ?? member.role) : null
}

const initials = (m) => (m.user.firstName || m.user.name || '?').charAt(0).toUpperCase()
</script>

<template>
  <div class="max-w-3xl mx-auto px-6 py-8 space-y-6">

    <div>
      <h2 class="text-lg font-semibold text-foreground mb-1">Members</h2>
      <p class="text-sm text-muted-foreground">
        Members of <span class="font-medium text-foreground">{{ data?.production?.name }}</span>.
      </p>
    </div>

    <!-- Add member -->
    <div class="rounded-xl border border-border p-4 space-y-3">
      <p class="text-sm font-medium text-foreground">Add member</p>
      <div class="flex gap-2">
        <input
          v-model="addEmail"
          type="email"
          placeholder="user@example.com"
          class="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          @keydown.enter="addMember"
        />
        <select
          v-model="addRoleId"
          class="h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">No role</option>
          <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option>
        </select>
        <button
          class="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          :disabled="!addEmail.trim() || addSaving"
          @click="addMember"
        >
          <Icon v-if="addSaving" icon="mdi:loading" class="animate-spin" />
          Add
        </button>
      </div>
      <p v-if="addError" class="text-xs text-destructive">{{ addError }}</p>
    </div>

    <!-- List -->
    <div v-if="loading" class="flex justify-center py-8">
      <Icon icon="mdi:loading" class="animate-spin text-2xl text-muted-foreground/50" />
    </div>
    <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>
    <div v-else-if="members.length === 0" class="text-center py-8 text-sm text-muted-foreground">
      No members yet.
    </div>
    <ul v-else class="divide-y divide-border rounded-xl border border-border overflow-hidden">
      <li
        v-for="member in members"
        :key="member.id"
        class="flex items-center gap-3 px-4 py-3 bg-card"
      >
        <div class="size-8 rounded-full bg-secondary text-foreground flex items-center justify-center text-xs font-bold shrink-0">
          {{ initials(member) }}
        </div>

        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-foreground truncate">
            {{ member.user.firstName ? `${member.user.firstName} ${member.user.lastName}`.trim() : member.user.name }}
          </p>
          <p class="text-xs text-muted-foreground truncate">{{ member.user.email }}</p>
        </div>

        <select
          :value="member.role?.id ?? ''"
          class="h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          @change="changeMemberRole(member, $event.target.value)"
        >
          <option value="">No role</option>
          <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option>
        </select>

        <span
          v-if="resolvedRole(member)"
          class="px-2 py-0.5 rounded-full text-xs font-medium shrink-0"
          :style="roleBadgeStyle(resolvedRole(member).hue)"
        >
          {{ resolvedRole(member).name }}
        </span>
        <span v-else class="text-xs text-muted-foreground shrink-0">—</span>

        <button
          class="p-1.5 rounded text-muted-foreground hover:text-destructive transition-colors"
          title="Remove member"
          @click="removeMember(member)"
        >
          <Icon icon="mdi:account-remove-outline" class="text-base" />
        </button>
      </li>
    </ul>

  </div>
</template>
