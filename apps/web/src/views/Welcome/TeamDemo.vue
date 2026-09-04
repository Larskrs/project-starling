<script setup lang="ts">
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { ListCard, ListHeader } from '@starling/ui'
import { Permission, decode } from '@starling/auth/permissions'
import MemberRow    from '../Production/components/MemberRow.vue'
import RoleSelector from '../Production/components/RoleSelector.vue'
import type { ProductionRole } from '../../types/api'

/**
 * Roles, and what they actually let someone do — the members list, the real
 * role selector, and the permission bits the API checks, decoded live.
 *
 * Changing a role here recomputes the permission list from the same bitfield
 * `@starling/auth` uses on the server, so the demo can't drift from the rules.
 */
const { VIEW, EDIT_TIMELINE, RENAME_CLIPS, MANAGE_STORAGE, MANAGE_TIMELINES,
        MANAGE_TRACK_TYPES, MANAGE_MEMBERS, MANAGE_ROLES } = Permission

const role = (
  id: string, name: string, hue: number, permissions: bigint,
): ProductionRole => ({
  id, name, hue,
  productionId: 'demo-production',
  permissions:  String(permissions),
  createdAt:    '2024-01-01T00:00:00.000Z',
})

const roles: ProductionRole[] = [
  role('role-director', 'Director', 265,
    VIEW | EDIT_TIMELINE | MANAGE_TIMELINES | MANAGE_TRACK_TYPES | MANAGE_STORAGE | MANAGE_MEMBERS | MANAGE_ROLES),
  role('role-operator', 'Operator', 155, VIEW | EDIT_TIMELINE | RENAME_CLIPS | MANAGE_STORAGE),
  role('role-crew',     'Crew',      45, VIEW | RENAME_CLIPS),
  role('role-guest',    'Guest',     350, VIEW),
]

const members = [
  { id: 'm1', user: { id: 'u1', firstName: 'Ada',   lastName: 'Sørensen', email: 'ada@example.com',   createdAt: '2024-02-11T09:00:00.000Z' } },
  { id: 'm2', user: { id: 'u2', firstName: 'Ivar',  lastName: 'Holt',     email: 'ivar@example.com',  createdAt: '2024-05-02T09:00:00.000Z' } },
  { id: 'm3', user: { id: 'u3', firstName: 'Nora',  lastName: 'Bakke',    email: 'nora@example.com',  createdAt: '2024-08-19T09:00:00.000Z' } },
]

const assigned = ref<Record<string, string | null>>({
  m1: 'role-director',
  m2: 'role-operator',
  m3: 'role-crew',
})

const focused = ref('m2')

const focusedRole = computed(() =>
  roles.find(r => r.id === assigned.value[focused.value]) ?? null,
)

/** i18n keys are the camelCase permission name — the same map RoleCard uses. */
const permissionKey = (name: string) =>
  `roles.permissions.${name.toLowerCase().replace(/_(\w)/g, (_, c: string) => c.toUpperCase())}`

const granted = computed(() =>
  focusedRole.value ? decode(BigInt(focusedRole.value.permissions)) : [],
)

const focusedName = computed(() => {
  const member = members.find(m => m.id === focused.value)
  return member?.user.firstName ?? ''
})
</script>

<template>
  <div class="grid gap-4 lg:grid-cols-[1fr_16rem]">
    <ListCard>
      <ListHeader :title="$t('members.title')" />
      <ul class="divide-y divide-border">
        <MemberRow
          v-for="member in members"
          :key="member.id"
          :member="member"
          class="cursor-pointer transition-colors"
          :class="focused === member.id ? 'bg-accent/50' : 'hover:bg-hover'"
          tabindex="0"
          @click="focused = member.id"
          @keydown.enter="focused = member.id"
        >
          <RoleSelector
            :model-value="assigned[member.id]"
            :roles="roles"
            @update:model-value="assigned = { ...assigned, [member.id]: $event }"
          />
        </MemberRow>
      </ul>
    </ListCard>

    <!-- Decoded from the role's bitfield, not a hand-written list -->
    <div class="rounded-xl border border-border bg-card p-4">
      <p class="text-xs font-medium text-muted-foreground">
        {{ $t('welcome.demo.team.canDo', { name: focusedName }) }}
      </p>
      <ul class="mt-3 flex flex-col gap-2">
        <li v-for="name in granted" :key="name" class="flex items-center gap-2 text-sm">
          <Icon icon="mdi:check-circle" class="size-4 shrink-0 text-primary" />
          {{ $t(permissionKey(name)) }}
        </li>
        <li v-if="!granted.length" class="text-sm text-muted-foreground">
          {{ $t('roles.noRole') }}
        </li>
      </ul>
    </div>
  </div>
</template>
