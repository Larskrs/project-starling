<script setup>
import { inject, ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button, Skeleton, ConfirmDialog } from '@starling/ui'
import ListCard   from '@starling/ui/ListCard'
import ListHeader from '@starling/ui/ListHeader'
import ListItem   from '@starling/ui/ListItem'
import { useApi } from '../../composables/useApi.js'
import ManagePageHeader from './components/ManagePageHeader.vue'
import TimelineDialog   from './components/TimelineDialog.vue'

const route      = useRoute()
const router     = useRouter()
const { t }      = useI18n()
const data       = inject('production-data')
const { $fetch } = useApi()

const timelinesList = ref([])
const loading       = ref(false)
const error         = ref('')

const createOpen  = ref(false)
const editTarget  = ref(null)
const deleteTarget = ref(null)
const deleting    = ref(false)

async function load() {
  loading.value = true
  error.value   = ''
  const { ok, data: res } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/timelines`,
    { silent: true },
  )
  loading.value = false
  if (!ok) { error.value = t('timelines.couldNotLoad'); return }
  timelinesList.value = res ?? []
}

onMounted(load)

function durationFrames(tl) {
  return tl.endFrame - tl.startFrame
}

function openEditor(tl) {
  router.push(`/c/${route.params.cslug}/p/${route.params.pslug}/editor/${tl.id}`)
}

function onCreated(tl)  { timelinesList.value.push(tl) }
function onUpdated(tl)  {
  const i = timelinesList.value.findIndex(x => x.id === tl.id)
  if (i !== -1) timelinesList.value[i] = tl
  editTarget.value = null
}

async function confirmDelete() {
  deleting.value = true
  const { ok } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/timelines/${deleteTarget.value.id}`,
    { method: 'DELETE' },
  )
  deleting.value = false
  if (ok) {
    timelinesList.value = timelinesList.value.filter(x => x.id !== deleteTarget.value.id)
    deleteTarget.value = null
  }
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

    <ListCard>
      <ListHeader :title="$t('timelines.title')">
        <template #action>
          <span
            v-if="!loading && timelinesList.length"
            class="text-xs tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md"
          >{{ timelinesList.length }}</span>
        </template>
      </ListHeader>

      <!-- Loading -->
      <ul v-if="loading" class="divide-y divide-border">
        <li v-for="i in 3" :key="i" class="flex items-center gap-3 px-4 py-3">
          <Skeleton class="size-4 rounded shrink-0" />
          <Skeleton class="h-4 flex-1 max-w-xs rounded" />
          <Skeleton class="h-5 w-12 rounded-full" />
          <Skeleton class="h-5 w-20 rounded-full" />
          <Skeleton class="size-7 rounded-md ml-auto" />
          <Skeleton class="size-7 rounded-md" />
          <Skeleton class="size-7 rounded-md" />
        </li>
      </ul>

      <!-- Error -->
      <p v-else-if="error" class="px-4 py-4 text-sm text-destructive">{{ error }}</p>

      <!-- Empty -->
      <div v-else-if="timelinesList.length === 0" class="py-14 text-center text-sm text-muted-foreground">
        {{ $t('timelines.noTimelines') }}
      </div>

      <!-- List -->
      <ul v-else class="divide-y divide-border">
        <ListItem v-for="tl in timelinesList" :key="tl.id">
          <Icon icon="mdi:timeline-outline" class="size-4 text-muted-foreground shrink-0" />
          <span class="flex-1 text-sm font-medium text-foreground truncate">{{ tl.name }}</span>
          <!-- Frame rate badge -->
          <span class="px-2 py-0.5 text-[11px] font-medium rounded-full bg-muted text-muted-foreground shrink-0">
            {{ tl.frameRate }} fps
          </span>
          <!-- Duration badge -->
          <span class="px-2 py-0.5 text-[11px] font-medium rounded-full bg-primary/10 text-primary shrink-0 tabular-nums">
            {{ durationFrames(tl).toLocaleString() }} {{ $t('timelines.frames') }}
          </span>
          <!-- Open editor -->
          <button
            class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
            :title="$t('timelines.openEditor')"
            @click="openEditor(tl)"
          >
            <Icon icon="mdi:open-in-app" class="size-3.5" />
          </button>
          <!-- Edit -->
          <button
            class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
            :title="$t('timelines.edit')"
            @click="editTarget = tl"
          >
            <Icon icon="mdi:pencil-outline" class="size-3.5" />
          </button>
          <!-- Delete -->
          <button
            class="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-accent transition-colors shrink-0"
            :title="$t('timelines.delete')"
            @click="deleteTarget = tl"
          >
            <Icon icon="mdi:trash-can-outline" class="size-3.5" />
          </button>
        </ListItem>
      </ul>
    </ListCard>

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
