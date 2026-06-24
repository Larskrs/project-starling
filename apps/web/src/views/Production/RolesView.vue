<script setup>
import { inject, ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Icon } from '@iconify/vue'
import { useApi } from '../../composables/useApi.js'

const route = useRoute()
const data  = inject('production-data')
const { $fetch } = useApi()

const PERMISSIONS = [
  { name: 'VIEW',           label: 'View',           bit: 1n },
  { name: 'EDIT_TIMELINE',  label: 'Edit timeline',  bit: 2n },
  { name: 'MANAGE_STORAGE', label: 'Manage storage', bit: 4n },
  { name: 'MANAGE_MEMBERS', label: 'Manage members', bit: 8n },
  { name: 'MANAGE_ROLES',   label: 'Manage roles',   bit: 16n },
  { name: 'ADMINISTRATOR',  label: 'Administrator',  bit: 32n },
]

// ── Load ──────────────────────────────────────────────────────────────────────
const roles   = ref([])
const loading = ref(false)
const error   = ref('')

async function loadRoles() {
  loading.value = true
  error.value   = ''
  const { ok, data: resData } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/roles`,
    { silent: true },
  )
  loading.value = false
  if (!ok) { error.value = 'Could not load roles'; return }
  roles.value = resData.map(r => ({ ...r, permissions: BigInt(r.permissions) }))
}

onMounted(loadRoles)

// ── Create ────────────────────────────────────────────────────────────────────
const newName   = ref('')
const newHue    = ref(200)
const creating  = ref(false)
const createErr = ref('')

async function createRole() {
  if (!newName.value.trim()) return
  creating.value  = true
  createErr.value = ''
  const { ok, data: resData, error } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/roles`,
    {
      method: 'POST',
      json:   { name: newName.value.trim(), hue: newHue.value, permissions: '0' },
      silent: true,
    },
  )
  creating.value = false
  if (!ok) { createErr.value = error ?? 'Failed to create role'; return }
  roles.value.push({ ...resData, permissions: BigInt(resData.permissions) })
  newName.value = ''
  newHue.value  = 200
}

// ── Edit ──────────────────────────────────────────────────────────────────────
const editing = ref(null)

function startEdit(role) {
  editing.value = { id: role.id, name: role.name, hue: role.hue, permissions: role.permissions }
}

function cancelEdit() { editing.value = null }

function togglePerm(bit) { editing.value.permissions ^= bit }

async function saveRole() {
  const e = editing.value
  const { ok, data: resData } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/roles/${e.id}`,
    { method: 'PATCH', json: { name: e.name, hue: e.hue, permissions: e.permissions.toString() } },
  )
  if (!ok) return
  const idx = roles.value.findIndex(r => r.id === resData.id)
  if (idx !== -1) roles.value[idx] = { ...resData, permissions: BigInt(resData.permissions) }
  editing.value = null
}

// ── Delete ────────────────────────────────────────────────────────────────────
async function deleteRole(role) {
  if (!confirm(`Delete role "${role.name}"? Members with this role will become unassigned.`)) return
  const { ok } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/roles/${role.id}`,
    { method: 'DELETE' },
  )
  if (ok) roles.value = roles.value.filter(r => r.id !== role.id)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function badgeStyle(hue) {
  return {
    backgroundColor: `oklch(65% 0.18 ${hue} / 0.15)`,
    color:           `oklch(60% 0.2 ${hue})`,
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-6 py-8 space-y-6">

    <div>
      <h2 class="text-lg font-semibold text-foreground mb-1">Roles</h2>
      <p class="text-sm text-muted-foreground">
        Manage roles and their permissions for
        <span class="font-medium text-foreground">{{ data?.production?.name }}</span>.
      </p>
    </div>

    <!-- Create form -->
    <div class="rounded-xl border border-border p-4 space-y-3">
      <p class="text-sm font-medium text-foreground">Create role</p>
      <div class="flex gap-2">
        <input
          v-model="newName"
          type="text"
          placeholder="Role name"
          maxlength="64"
          class="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          @keydown.enter="createRole"
        />
        <div class="flex items-center gap-2">
          <input v-model.number="newHue" type="range" min="0" max="360" class="w-24 accent-primary" />
          <span class="size-4 rounded-full shrink-0" :style="{ backgroundColor: `oklch(65% 0.18 ${newHue})` }" />
        </div>
        <button
          class="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          :disabled="!newName.trim() || creating"
          @click="createRole"
        >
          <Icon v-if="creating" icon="mdi:loading" class="animate-spin" />
          Create
        </button>
      </div>
      <p v-if="createErr" class="text-xs text-destructive">{{ createErr }}</p>
    </div>

    <!-- List -->
    <div v-if="loading" class="flex justify-center py-8">
      <Icon icon="mdi:loading" class="animate-spin text-2xl text-muted-foreground/50" />
    </div>
    <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>
    <div v-else-if="roles.length === 0" class="text-center py-8 text-sm text-muted-foreground">
      No roles yet.
    </div>
    <ul v-else class="space-y-3">
      <li
        v-for="role in roles"
        :key="role.id"
        class="rounded-xl border border-border bg-card overflow-hidden"
      >
        <!-- Header -->
        <div class="flex items-center gap-3 px-4 py-3">
          <span
            class="size-3 rounded-full shrink-0"
            :style="{ backgroundColor: `oklch(65% 0.18 ${editing?.id === role.id ? editing.hue : role.hue})` }"
          />
          <span class="flex-1 text-sm font-medium text-foreground">{{ role.name }}</span>
          <button
            class="p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors"
            :title="editing?.id === role.id ? 'Cancel' : 'Edit'"
            @click="editing?.id === role.id ? cancelEdit() : startEdit(role)"
          >
            <Icon :icon="editing?.id === role.id ? 'mdi:close' : 'mdi:pencil-outline'" class="text-base" />
          </button>
          <button
            class="p-1.5 rounded text-muted-foreground hover:text-destructive transition-colors"
            title="Delete role"
            @click="deleteRole(role)"
          >
            <Icon icon="mdi:trash-can-outline" class="text-base" />
          </button>
        </div>

        <!-- Inline editor -->
        <div v-if="editing?.id === role.id" class="border-t border-border px-4 py-3 space-y-3 bg-background/50">
          <div class="flex gap-2">
            <input
              v-model="editing.name"
              type="text"
              maxlength="64"
              class="flex-1 h-8 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div class="flex items-center gap-2">
              <input v-model.number="editing.hue" type="range" min="0" max="360" class="w-24 accent-primary" />
              <span class="size-4 rounded-full shrink-0" :style="{ backgroundColor: `oklch(65% 0.18 ${editing.hue})` }" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-1.5">
            <label
              v-for="perm in PERMISSIONS"
              :key="perm.name"
              class="flex items-center gap-2 cursor-pointer group"
            >
              <div
                class="size-4 rounded border flex items-center justify-center transition-colors shrink-0"
                :class="(editing.permissions & perm.bit) !== 0n
                  ? 'bg-primary border-primary'
                  : 'border-border group-hover:border-muted-foreground'"
                @click="togglePerm(perm.bit)"
              >
                <Icon
                  v-if="(editing.permissions & perm.bit) !== 0n"
                  icon="mdi:check"
                  class="text-primary-foreground text-[10px]"
                />
              </div>
              <span class="text-xs text-muted-foreground group-hover:text-foreground transition-colors select-none">
                {{ perm.label }}
              </span>
            </label>
          </div>

          <div class="flex justify-end">
            <button
              class="h-8 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              @click="saveRole"
            >
              Save
            </button>
          </div>
        </div>

        <!-- Permission summary -->
        <div v-else class="border-t border-border px-4 py-2 flex flex-wrap gap-1.5">
          <span v-if="role.permissions === 0n" class="text-xs text-muted-foreground">No permissions</span>
          <span
            v-for="perm in PERMISSIONS.filter(p => (role.permissions & p.bit) !== 0n)"
            :key="perm.name"
            class="px-2 py-0.5 rounded-full text-[11px] font-medium"
            :style="badgeStyle(role.hue)"
          >
            {{ perm.label }}
          </span>
        </div>
      </li>
    </ul>

  </div>
</template>
