<script setup>
import { inject, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Badge, Button, ConfirmDialog, IconButton, ListItem, ListSection, Skeleton } from '@starling/ui'
import { useProductionCrud } from '../../composables/useProductionCrud.js'
import ManagePageHeader from './components/ManagePageHeader.vue'
import TimelineDialog   from './components/TimelineDialog.vue'

const route  = useRoute()
const router = useRouter()
const { t }  = useI18n()
const data   = inject('production-data')

const {
  items: timelinesList, loading, error, load,
  createOpen, editTarget, deleteTarget, deleting,
  onCreated, onUpdated, confirmDelete,
} = useProductionCrud('timelines', { loadError: () => t('timelines.couldNotLoad') })

onMounted(load)

function durationFrames(tl) {
  return tl.endFrame - tl.startFrame
}

function openEditor(tl) {
  router.push(`/c/${route.params.cslug}/p/${route.params.pslug}/editor/${tl.id}`)
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-6 py-8 flex flex-col gap-5">

    <ManagePageHeader>
      <template #title>{{ $t('timelines.title') }}</template>
      <template #description>
        {{ $t('timelines.description', { production: data?.production?.name }) }}
      </template>
      <template #action>
        <Button size="sm" @click="createOpen = true">
          <Icon icon="mdi:plus" class="text-base" />
          {{ $t('timelines.addTimeline') }}
        </Button>
      </template>
    </ManagePageHeader>

    <ListSection
      :title="$t('timelines.title')"
      :loading="loading"
      :error="error"
      :count="timelinesList.length"
    >
      <template #skeleton>
        <Skeleton class="size-4 rounded shrink-0" />
        <Skeleton class="h-4 flex-1 max-w-xs rounded" />
        <Skeleton class="h-5 w-12 rounded-full" />
        <Skeleton class="h-5 w-20 rounded-full" />
        <Skeleton class="size-7 rounded-md ml-auto" />
        <Skeleton class="size-7 rounded-md" />
        <Skeleton class="size-7 rounded-md" />
      </template>

      <template #empty>{{ $t('timelines.noTimelines') }}</template>

      <ListItem v-for="tl in timelinesList" :key="tl.id">
        <Icon icon="mdi:timeline-outline" class="size-4 text-muted-foreground shrink-0" />
        <span class="flex-1 text-sm font-medium text-foreground truncate">{{ tl.name }}</span>
        <Badge>{{ tl.frameRate }} fps</Badge>
        <Badge variant="primary" class="tabular-nums">
          {{ durationFrames(tl).toLocaleString() }} {{ $t('timelines.frames') }}
        </Badge>
        <IconButton icon="mdi:open-in-app" :title="$t('timelines.openEditor')" @click="openEditor(tl)" />
        <IconButton icon="mdi:pencil-outline" :title="$t('timelines.edit')" @click="editTarget = tl" />
        <IconButton icon="mdi:trash-can-outline" destructive :title="$t('timelines.delete')" @click="deleteTarget = tl" />
      </ListItem>
    </ListSection>

    <!-- Create dialog -->
    <TimelineDialog
      :open="createOpen"
      @update:open="createOpen = $event"
      @created="onCreated"
    />

    <!-- Edit dialog -->
    <TimelineDialog
      :open="editTarget !== null"
      :timeline="editTarget"
      @update:open="!$event && (editTarget = null)"
      @updated="onUpdated"
    />

    <!-- Delete confirm -->
    <ConfirmDialog
      :open="deleteTarget !== null"
      :title="$t('timelines.confirmDeleteTitle')"
      :confirm-label="$t('timelines.delete')"
      :cancel-label="$t('timelines.cancel')"
      :loading="deleting"
      destructive
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
    >
      {{ $t('timelines.confirmDelete', { name: deleteTarget?.name }) }}
    </ConfirmDialog>

  </div>
</template>
