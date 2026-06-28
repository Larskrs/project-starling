<script setup>
import { inject, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { Icon } from '@iconify/vue'
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

    <div v-if="loading" class="flex justify-center py-8">
      <Icon icon="mdi:loading" class="animate-spin text-2xl text-muted-foreground/50" />
    </div>
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
