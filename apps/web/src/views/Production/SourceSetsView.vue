<script setup>
import { inject, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button, ConfirmDialog, IconButton, ListItem, ListSection, Skeleton } from '@starling/ui'
import { useProductionCrud } from '../../composables/useProductionCrud.js'
import ManagePageHeader from './components/ManagePageHeader.vue'
import SourceSetDialog  from './components/SourceSetDialog.vue'

const route  = useRoute()
const router = useRouter()
const { t }  = useI18n()
const data   = inject('production-data')

const {
  items: sourceSets, loading, error, load,
  createOpen, editTarget: renameTarget, deleteTarget, deleting,
  onCreated, onUpdated, confirmDelete,
} = useProductionCrud('source-sets', { loadError: () => t('sourceSets.couldNotLoad') })

onMounted(load)

function openDetail(id) {
  router.push(`/c/${route.params.cslug}/p/${route.params.pslug}/source-sets/${id}`)
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-6 py-8 flex flex-col gap-5">

    <ManagePageHeader>
      <template #title>{{ $t('sourceSets.title') }}</template>
      <template #description>
        {{ $t('sourceSets.description', { production: data?.production?.name }) }}
      </template>
      <template #action>
        <Button size="sm" @click="createOpen = true">
          <Icon icon="mdi:plus" class="text-base" />
          {{ $t('sourceSets.addSet') }}
        </Button>
      </template>
    </ManagePageHeader>

    <ListSection
      :title="$t('sourceSets.title')"
      :loading="loading"
      :error="error"
      :count="sourceSets.length"
    >
      <template #skeleton>
        <Skeleton class="size-5 rounded shrink-0" />
        <Skeleton class="h-4 flex-1 max-w-xs rounded" />
        <Skeleton class="size-7 rounded-md ml-auto" />
        <Skeleton class="size-7 rounded-md" />
        <Skeleton class="size-7 rounded-md" />
      </template>

      <template #empty>{{ $t('sourceSets.noSets') }}</template>

      <ListItem v-for="s in sourceSets" :key="s.id">
        <Icon icon="mdi:layers-outline" class="size-4 text-muted-foreground shrink-0" />
        <button
          class="flex-1 text-left text-sm font-medium text-foreground hover:text-primary transition-colors truncate"
          @click="openDetail(s.id)"
        >
          {{ s.name }}
        </button>
        <IconButton icon="mdi:chevron-right" :title="$t('sourceSets.openSet')" @click="openDetail(s.id)" />
        <IconButton icon="mdi:pencil-outline" :title="$t('sourceSets.rename')" @click="renameTarget = s" />
        <IconButton icon="mdi:trash-can-outline" destructive :title="$t('sourceSets.delete')" @click="deleteTarget = s" />
      </ListItem>
    </ListSection>

    <!-- Create dialog -->
    <SourceSetDialog
      :open="createOpen"
      @update:open="createOpen = $event"
      @created="onCreated"
    />

    <!-- Rename dialog -->
    <SourceSetDialog
      :open="renameTarget !== null"
      :source-set="renameTarget"
      @update:open="!$event && (renameTarget = null)"
      @updated="onUpdated"
    />

    <!-- Delete confirm -->
    <ConfirmDialog
      :open="deleteTarget !== null"
      :title="$t('sourceSets.confirmDeleteTitle')"
      :confirm-label="$t('sourceSets.delete')"
      :cancel-label="$t('sourceSets.cancel')"
      :loading="deleting"
      destructive
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
    >
      {{ $t('sourceSets.confirmDelete', { name: deleteTarget?.name }) }}
    </ConfirmDialog>

  </div>
</template>
