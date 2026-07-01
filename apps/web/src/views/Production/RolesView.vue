<script setup>
import { inject, ref, onMounted } from 'vue'
import { Skeleton } from '@starling/ui'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { useApi } from '../../composables/useApi.js'
import CreateRoleForm from './components/CreateRoleForm.vue'
import RoleCard from './components/RoleCard.vue'

const route = useRoute()
const data  = inject('production-data')
const { t } = useI18n()
const { $fetch } = useApi()

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
  if (!ok) { error.value = t('roles.couldNotLoad'); return }
  roles.value = resData.map(r => ({ ...r, permissions: BigInt(r.permissions) }))
}

onMounted(loadRoles)

function onCreated(role) { roles.value.push(role) }

function onUpdated(role) {
  const idx = roles.value.findIndex(r => r.id === role.id)
  if (idx !== -1) roles.value[idx] = role
}

function onDeleted(roleId) {
  roles.value = roles.value.filter(r => r.id !== roleId)
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-6 py-8 space-y-6">

    <div>
      <h2 class="text-lg font-semibold text-foreground mb-1">{{ $t('roles.title') }}</h2>
      <p class="text-sm text-muted-foreground">
        {{ $t('roles.description') }}
        <span class="font-medium text-foreground">{{ data?.production?.name }}</span>.
      </p>
    </div>

    <CreateRoleForm @created="onCreated" />

    <ul v-if="loading" class="space-y-3">
      <li v-for="i in 3" :key="i" class="rounded-xl border border-border px-5 py-4 flex items-center gap-4">
        <Skeleton class="size-3 rounded-full shrink-0" />
        <Skeleton class="h-5 w-28 rounded" />
        <div class="flex gap-1.5 ml-2">
          <Skeleton v-for="j in 3" :key="j" class="h-5 w-16 rounded-full" />
        </div>
      </li>
    </ul>
    <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>
    <div v-else-if="roles.length === 0" class="text-center py-8 text-sm text-muted-foreground">
      {{ $t('roles.noRoles') }}
    </div>
    <ul v-else class="space-y-3">
      <RoleCard
        v-for="role in roles"
        :key="role.id"
        :role="role"
        @updated="onUpdated"
        @deleted="onDeleted"
      />
    </ul>

  </div>
</template>
