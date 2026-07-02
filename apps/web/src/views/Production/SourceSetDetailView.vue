<script setup>
import { inject, ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button, ConfirmDialog, IconButton, ListItem, ListSection, Skeleton } from '@starling/ui'
import { useApi } from '../../composables/useApi.js'
import { useProductionCrud } from '../../composables/useProductionCrud.js'
import ManagePageHeader from './components/ManagePageHeader.vue'
import SourceBadge      from './components/SourceBadge.vue'
import SourceDialog     from './components/SourceDialog.vue'

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
} = useProductionCrud(() => `source-sets/${setId.value}/sources`, {
  loadError: () => t('sources.couldNotLoad'),
})

onMounted(() => {
  loadSources()
  $fetch(`/api/company/${route.params.cslug}/production/${route.params.pslug}/source-sets`, { silent: true })
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
  <div class="max-w-3xl mx-auto px-6 py-8 flex flex-col gap-5">

    <ManagePageHeader>
      <template #back>
        <IconButton class="mt-0.5 rounded-lg" :title="$t('sources.backToSets')" @click="goBack">
          <Icon icon="mdi:arrow-left" class="size-4" />
        </IconButton>
      </template>
      <template #title>
        <Skeleton v-if="loading && !setName" class="h-6 w-36 rounded" />
        <template v-else>{{ setName }}</template>
      </template>
      <template #description>
        {{ $t('sources.description', { production: data?.production?.name }) }}
      </template>
      <template #action>
        <Button size="sm" @click="createOpen = true">
          <Icon icon="mdi:plus" class="text-base" />
          {{ $t('sources.addSource') }}
        </Button>
      </template>
    </ManagePageHeader>

    <ListSection
      :title="$t('sources.title')"
      :loading="loading"
      :error="error"
      :count="sources.length"
      :skeleton-rows="4"
    >
      <template #skeleton>
        <Skeleton class="h-5 w-8 rounded shrink-0" />
        <Skeleton class="h-4 flex-1 max-w-xs rounded" />
        <Skeleton class="size-7 rounded-md ml-auto" />
        <Skeleton class="size-7 rounded-md" />
      </template>

      <template #empty>{{ $t('sources.noSources') }}</template>

      <ListItem v-for="s in sources" :key="s.id">
        <SourceBadge :short-name="s.shortName" :hue="s.hue" />
        <span class="flex-1 text-sm font-medium text-foreground truncate">{{ s.name }}</span>
        <IconButton icon="mdi:pencil-outline" :title="$t('sources.edit')" @click="editTarget = s" />
        <IconButton icon="mdi:trash-can-outline" destructive :title="$t('sources.delete')" @click="deleteTarget = s" />
      </ListItem>
    </ListSection>

    <!-- Create dialog -->
    <SourceDialog
      :open="createOpen"
      :set-id="setId"
      @update:open="createOpen = $event"
      @created="onCreated"
    />

    <!-- Edit dialog -->
    <SourceDialog
      :open="editTarget !== null"
      :set-id="setId"
      :source="editTarget"
      @update:open="!$event && (editTarget = null)"
      @updated="onUpdated"
    />

    <!-- Delete confirm -->
    <ConfirmDialog
      :open="deleteTarget !== null"
      :title="$t('sources.confirmDeleteTitle')"
      :confirm-label="$t('sources.delete')"
      :cancel-label="$t('sources.cancel')"
      :loading="deleting"
      destructive
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
    >
      {{ $t('sources.confirmDelete', { name: deleteTarget?.name }) }}
    </ConfirmDialog>

  </div>
</template>
