<script setup>
import { inject, ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Badge, Button, ConfirmDialog, IconButton, ListItem, ListSection, Skeleton } from '@starling/ui'
import { useApi } from '../../composables/useApi.js'
import { useProductionCrud } from '../../composables/useProductionCrud.js'
import ManagePageHeader from './components/ManagePageHeader.vue'
import TrackTypeDialog  from './components/TrackTypeDialog.vue'

const route      = useRoute()
const { t }      = useI18n()
const data       = inject('production-data')
const { $fetch } = useApi()

const {
  items: trackTypes, loading, error, load: loadTrackTypes,
  createOpen, editTarget, deleteTarget, deleting,
  onCreated, onUpdated, confirmDelete,
} = useProductionCrud('track-types', { loadError: () => t('trackTypes.couldNotLoad') })

const sourceSets = ref([])

onMounted(() => {
  loadTrackTypes()
  $fetch(`/api/company/${route.params.cslug}/production/${route.params.pslug}/source-sets`, { silent: true })
    .then(({ ok, data: res }) => { if (ok) sourceSets.value = res ?? [] })
})

function setName(id) {
  return sourceSets.value.find(s => s.id === id)?.name ?? '—'
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-6 py-8 flex flex-col gap-5">

    <ManagePageHeader>
      <template #title>{{ $t('trackTypes.title') }}</template>
      <template #description>
        {{ $t('trackTypes.description', { production: data?.production?.name }) }}
      </template>
      <template #action>
        <Button size="sm" @click="createOpen = true">
          <Icon icon="mdi:plus" class="text-base" />
          {{ $t('trackTypes.addType') }}
        </Button>
      </template>
    </ManagePageHeader>

    <ListSection
      :title="$t('trackTypes.title')"
      :loading="loading"
      :error="error"
      :count="trackTypes.length"
      :skeleton-rows="4"
    >
      <template #skeleton>
        <Skeleton class="size-3 rounded-full shrink-0" />
        <Skeleton class="h-4 flex-1 max-w-xs rounded" />
        <Skeleton class="h-5 w-14 rounded-full" />
        <Skeleton class="h-5 w-20 rounded-full" />
        <Skeleton class="size-7 rounded-md ml-auto" />
        <Skeleton class="size-7 rounded-md" />
      </template>

      <template #empty>{{ $t('trackTypes.noTypes') }}</template>

      <ListItem v-for="tt in trackTypes" :key="tt.id">
        <!-- Color dot -->
        <span
          class="size-2.5 rounded-full shrink-0"
          :style="{ backgroundColor: tt.color ?? 'oklch(65% 0.18 250)' }"
        />
        <span class="flex-1 text-sm font-medium text-foreground truncate">{{ tt.name }}</span>
        <Badge>{{ tt.trackMode === 'event' ? $t('trackTypes.modeEvent') : $t('trackTypes.modeClip') }}</Badge>
        <Badge v-if="tt.sourceSetId" variant="primary" class="max-w-28 truncate">{{ setName(tt.sourceSetId) }}</Badge>
        <IconButton icon="mdi:pencil-outline" :title="$t('trackTypes.edit')" @click="editTarget = tt" />
        <IconButton icon="mdi:trash-can-outline" destructive :title="$t('trackTypes.delete')" @click="deleteTarget = tt" />
      </ListItem>
    </ListSection>

    <!-- Create dialog -->
    <TrackTypeDialog
      :open="createOpen"
      :source-sets="sourceSets"
      @update:open="createOpen = $event"
      @created="onCreated"
    />

    <!-- Edit dialog -->
    <TrackTypeDialog
      :open="editTarget !== null"
      :track-type="editTarget"
      :source-sets="sourceSets"
      @update:open="!$event && (editTarget = null)"
      @updated="onUpdated"
    />

    <!-- Delete confirm -->
    <ConfirmDialog
      :open="deleteTarget !== null"
      :title="$t('trackTypes.confirmDeleteTitle')"
      :confirm-label="$t('trackTypes.delete')"
      :cancel-label="$t('trackTypes.cancel')"
      :loading="deleting"
      destructive
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
    >
      {{ $t('trackTypes.confirmDelete', { name: deleteTarget?.name }) }}
    </ConfirmDialog>

  </div>
</template>
