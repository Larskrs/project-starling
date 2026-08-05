<script setup>
import { inject, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Avatar, Button, IconButton, Skeleton } from '@starling/ui'
import { useProductionCrud } from '../../composables/useProductionCrud'
import { useTimelineOpening } from '../../composables/useTimelineOpening'
import ManageListPage from './components/ManageListPage.vue'
import TimelineDialog from './components/TimelineDialog.vue'

const route  = useRoute()
const router = useRouter()
const { t }  = useI18n()
const data   = inject('production-data')
const { startOpening } = useTimelineOpening()

const {
  items: timelinesList, loading, error, load,
  createOpen, editTarget, deleteTarget, deleting,
  onCreated, onUpdated, confirmDelete,
} = useProductionCrud(() => `/api/timelines?pid=${data.value?.production?.id}`, {
  loadError: () => t('timelines.couldNotLoad'),
  itemBase:  '/api/timeline',
})

onMounted(load)

function durationFrames(tl) {
  return tl.endFrame - tl.startFrame
}

const pad = n => String(n).padStart(2, '0')

/**
 * Frame count → HH:MM:SS:FF. Drop-frame rates are shown at their nearest whole
 * fps, which is what the editor's ruler does — this is a duration at a glance,
 * not a timecode you can conform against.
 */
function duration(tl) {
  const fps    = Math.round(parseFloat(tl.frameRate)) || 25
  const frames = Math.max(0, durationFrames(tl))
  return [
    pad(Math.floor(frames / (fps * 3600))),
    pad(Math.floor(frames / (fps * 60)) % 60),
    pad(Math.floor(frames / fps) % 60),
    pad(frames % fps),
  ].join(':')
}

function openEditor(tl) {
  // Names the loading screen before the route even starts resolving.
  startOpening(tl)
  router.push(`/c/${route.params.cslug}/p/${route.params.pslug}/editor/${tl.id}`)
}
</script>

<template>
  <ManageListPage
    :title="$t('timelines.title')"
    :description="$t('timelines.description', { production: data?.production?.name })"
    :loading="loading"
    :error="error"
    :count="timelinesList.length"
    :delete-target="deleteTarget"
    :deleting="deleting"
    :delete-title="$t('timelines.confirmDeleteTitle')"
    :delete-label="$t('timelines.delete')"
    :cancel-label="$t('timelines.cancel')"
    :delete-message="$t('timelines.confirmDelete', { name: deleteTarget?.name })"
    @confirm-delete="confirmDelete"
    @cancel-delete="deleteTarget = null"
  >
    <template #action>
      <Button size="sm" @click="createOpen = true">
        <Icon icon="mdi:plus" class="text-base" />
        {{ $t('timelines.addTimeline') }}
      </Button>
    </template>

    <template #skeleton>
      <Skeleton class="size-12 rounded-lg shrink-0" />
      <div class="flex-1 flex flex-col gap-2">
        <Skeleton class="h-4 w-48 max-w-full rounded" />
        <Skeleton class="h-3 w-36 max-w-full rounded" />
      </div>
      <Skeleton class="size-8 rounded-md" />
      <Skeleton class="size-8 rounded-md" />
    </template>

    <template #empty>{{ $t('timelines.noTimelines') }}</template>

    <li
      v-for="tl in timelinesList"
      :key="tl.id"
      class="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-hover"
    >
      <!--
        The row itself opens the editor — the common action shouldn't need a
        button hunt. Edit/delete stay as explicit controls beside it.
      -->
      <button
        type="button"
        class="flex flex-1 min-w-0 items-center gap-4 text-left"
        :title="$t('timelines.openEditor')"
        @click="openEditor(tl)"
      >
        <Avatar :id="tl.profileImageId" :alt="tl.name" class="size-12 rounded-lg shrink-0">
          <Icon icon="mdi:movie-open-outline" class="size-6 text-muted-foreground/60" />
        </Avatar>

        <div class="min-w-0 flex flex-col gap-0.5">
          <span class="text-sm font-medium text-foreground truncate">{{ tl.name }}</span>
          <span class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span class="tabular-nums">{{ duration(tl) }}</span>
            <span class="text-muted-foreground/40" aria-hidden="true">·</span>
            <span>{{ tl.frameRate }} fps</span>
            <span class="text-muted-foreground/40" aria-hidden="true">·</span>
            <span class="tabular-nums">{{ durationFrames(tl).toLocaleString() }} {{ $t('timelines.frames') }}</span>
          </span>
        </div>

        <Icon
          icon="mdi:arrow-right"
          class="ml-auto size-5 shrink-0 text-muted-foreground/0 transition-all duration-150
                 group-hover:text-muted-foreground/70 group-hover:translate-x-0.5"
        />
      </button>

      <IconButton icon="mdi:pencil-outline" :title="$t('timelines.edit')" class="p-2" @click="editTarget = tl" />
      <IconButton icon="mdi:trash-can-outline" destructive :title="$t('timelines.delete')" class="p-2" @click="deleteTarget = tl" />
    </li>

    <template #dialogs>
      <TimelineDialog :open="createOpen" @update:open="createOpen = $event" @created="onCreated" />
      <TimelineDialog
        :open="editTarget !== null"
        :timeline="editTarget"
        @update:open="!$event && (editTarget = null)"
        @updated="onUpdated"
      />
    </template>
  </ManageListPage>
</template>
