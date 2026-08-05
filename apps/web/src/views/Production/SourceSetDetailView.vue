<script setup>
import { inject, ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button, IconButton, ListItem, Skeleton } from '@starling/ui'
import { useApi } from '../../composables/useApi.js'
import { useProductionCrud } from '../../composables/useProductionCrud.js'
import ManageListPage from './components/ManageListPage.vue'
import SourceBadge    from './components/SourceBadge.vue'
import SourceDialog   from './components/SourceDialog.vue'

const route      = useRoute()
const router     = useRouter()
const { t }      = useI18n()
const data       = inject('production-data')
const { $fetch } = useApi()

const setId   = computed(() => route.params.setId)
const setName = ref('')

const {
  items: sources, loading, error, load: loadSources,
  createOpen, editTarget, deleteTarget, deleting,
  onCreated, onUpdated, confirmDelete,
} = useProductionCrud(() => `sources?sid=${setId.value}`, {
  loadError: () => t('sources.couldNotLoad'),
})

onMounted(() => {
  loadSources()
  $fetch(`/api/production/${data.value?.production?.id}/source-sets`, { silent: true })
    .then(({ ok, data: res }) => {
      if (ok) setName.value = res?.find(s => s.id === setId.value)?.name ?? ''
      else error.value = t('sources.couldNotLoad')
    })
})

function goBack() {
  router.push(`/c/${route.params.cslug}/p/${route.params.pslug}/source-sets`)
}
</script>

<template>
  <ManageListPage
    :title="setName"
    :list-title="$t('sources.title')"
    :description="$t('sources.description', { production: data?.production?.name })"
    :loading="loading"
    :error="error"
    :count="sources.length"
    :skeleton-rows="4"
    :delete-target="deleteTarget"
    :deleting="deleting"
    :delete-title="$t('sources.confirmDeleteTitle')"
    :delete-label="$t('sources.delete')"
    :cancel-label="$t('sources.cancel')"
    :delete-message="$t('sources.confirmDelete', { name: deleteTarget?.name })"
    @confirm-delete="confirmDelete"
    @cancel-delete="deleteTarget = null"
  >
    <template #back>
      <IconButton class="mt-0.5 rounded-lg" :title="$t('sources.backToSets')" @click="goBack">
        <Icon icon="mdi:arrow-left" class="size-4" />
      </IconButton>
    </template>

    <!-- The name arrives with the set list, a beat after the rows do. -->
    <template #title>
      <Skeleton v-if="loading && !setName" class="h-6 w-36 rounded" />
      <template v-else>{{ setName }}</template>
    </template>

    <template #action>
      <Button size="sm" @click="createOpen = true">
        <Icon icon="mdi:plus" class="text-base" />
        {{ $t('sources.addSource') }}
      </Button>
    </template>

    <template #skeleton>
      <Skeleton class="h-5 w-8 rounded shrink-0" />
      <Skeleton class="h-4 flex-1 max-w-xs rounded" />
      <Skeleton class="size-7 rounded-md ml-auto" />
      <Skeleton class="size-7 rounded-md" />
    </template>

    <template #empty>{{ $t('sources.noSources') }}</template>

    <ListItem v-for="s in sources" :key="s.id">
      <SourceBadge :short-name="s.shortName" :hue="s.hue" :icon="s.icon" />
      <span class="flex-1 text-sm font-medium text-foreground truncate">{{ s.name }}</span>
      <IconButton icon="mdi:pencil-outline" :title="$t('sources.edit')" @click="editTarget = s" />
      <IconButton icon="mdi:trash-can-outline" destructive :title="$t('sources.delete')" @click="deleteTarget = s" />
    </ListItem>

    <template #dialogs>
      <SourceDialog :open="createOpen" :set-id="setId" @update:open="createOpen = $event" @created="onCreated" />
      <SourceDialog
        :open="editTarget !== null"
        :set-id="setId"
        :source="editTarget"
        @update:open="!$event && (editTarget = null)"
        @updated="onUpdated"
      />
    </template>
  </ManageListPage>
</template>
