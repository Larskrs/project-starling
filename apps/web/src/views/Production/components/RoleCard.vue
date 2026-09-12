<script setup>
import { ref, inject, computed } from 'vue'
import { Icon } from '@iconify/vue'
import { Badge, ConfirmDialog, IconButton } from '@starling/ui'
import { Permission, PERMISSIONS as PERMISSION_NAMES } from '@starling/auth/permissions'
import { useApi } from '../../../composables/useApi'

const props = defineProps({
  role: { type: Object, required: true },
})

const emit = defineEmits(['updated', 'deleted'])

const { $fetch } = useApi()
const data       = inject('production-data')
const rolesBase  = computed(() => `/api/production/${data.value?.production?.id}/roles`)

// i18n keys are the camelCase form of the permission name (MANAGE_ROLES → manageRoles)
const PERMISSIONS = PERMISSION_NAMES.map(name => ({
  name,
  key: `roles.permissions.${name.toLowerCase().replace(/_(\w)/g, (_, c) => c.toUpperCase())}`,
  bit: Permission[name],
}))

const editing = ref(null)

function startEdit() {
  editing.value = { id: props.role.id, name: props.role.name, hue: props.role.hue, permissions: props.role.permissions }
}

function cancelEdit() { editing.value = null }

function togglePerm(bit) { editing.value.permissions ^= bit }

function badgeStyle(hue) {
  return {
    backgroundColor: `oklch(65% 0.18 ${hue} / 0.15)`,
    color:           `oklch(60% 0.2 ${hue})`,
  }
}

async function saveRole() {
  const e = editing.value
  const { ok, data } = await $fetch(
    `${rolesBase.value}/${e.id}`,
    { method: 'PATCH', json: { name: e.name, hue: e.hue, permissions: e.permissions.toString() } },
  )
  if (!ok) return
  emit('updated', { ...data, permissions: BigInt(data.permissions) })
  editing.value = null
}

/**
 * Deleting a role goes through the app's own ConfirmDialog rather than the
 * browser's confirm(). Native confirm ignores the theme, blocks the main
 * thread, and gives a destructive action no visual weight — and once a user
 * ticks "prevent this page from creating additional dialogs" it returns false
 * forever, so the delete would silently stop working.
 */
const confirmingDelete = ref(false)
const deleting = ref(false)

async function deleteRole() {
  deleting.value = true
  const { ok } = await $fetch(
    `${rolesBase.value}/${props.role.id}`,
    { method: 'DELETE' },
  )
  deleting.value = false
  confirmingDelete.value = false
  if (ok) emit('deleted', props.role.id)
}
</script>

<template>
  <li class="rounded-xl border border-border bg-card overflow-hidden">

    <div class="flex items-center gap-3 px-4 py-3">
      <span
        class="size-3 rounded-full shrink-0"
        :style="{ backgroundColor: `oklch(65% 0.18 ${editing ? editing.hue : role.hue})` }"
      />
      <span class="flex-1 text-sm font-medium text-foreground">{{ role.name }}</span>
      <IconButton
        :title="editing ? $t('roles.cancel') : $t('roles.edit')"
        @click="editing ? cancelEdit() : startEdit()"
      >
        <Icon :icon="editing ? 'mdi:close' : 'mdi:pencil-outline'" class="text-base" />
      </IconButton>
      <IconButton destructive :title="$t('roles.deleteRole')" @click="confirmingDelete = true">
        <Icon icon="mdi:trash-can-outline" class="text-base" />
      </IconButton>
    </div>

    <div v-if="editing" class="border-t border-border px-4 py-3 space-y-3 bg-background/50">
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
        <label v-for="perm in PERMISSIONS" :key="perm.name" class="flex items-center gap-2 cursor-pointer group">
          <div
            class="size-4 rounded border flex items-center justify-center transition-colors shrink-0"
            :class="(editing.permissions & perm.bit) !== 0n
              ? 'bg-primary border-primary'
              : 'border-border group-hover:border-muted-foreground'"
            @click="togglePerm(perm.bit)"
          >
            <Icon v-if="(editing.permissions & perm.bit) !== 0n" icon="mdi:check" class="text-primary-foreground text-[10px]" />
          </div>
          <span class="text-xs text-muted-foreground group-hover:text-foreground transition-colors select-none">
            {{ $t(perm.key) }}
          </span>
        </label>
      </div>

      <div class="flex justify-end">
        <button
          class="h-8 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          @click="saveRole"
        >
          {{ $t('roles.save') }}
        </button>
      </div>
    </div>

    <div v-else class="border-t border-border px-4 py-2 flex flex-wrap gap-1.5">
      <span v-if="role.permissions === 0n" class="text-xs text-muted-foreground">{{ $t('roles.noPermissions') }}</span>
      <Badge
        v-for="perm in PERMISSIONS.filter(p => (role.permissions & p.bit) !== 0n)"
        :key="perm.name"
        :style="badgeStyle(role.hue)"
      >
        {{ $t(perm.key) }}
      </Badge>
    </div>

    <ConfirmDialog
      :open="confirmingDelete"
      :title="$t('roles.deleteRole')"
      :confirm-label="$t('roles.deleteRole')"
      :cancel-label="$t('roles.cancel')"
      :loading="deleting"
      destructive
      @confirm="deleteRole"
      @cancel="confirmingDelete = false"
    >
      {{ $t('roles.confirmDelete', { name: role.name }) }}
    </ConfirmDialog>

  </li>
</template>
