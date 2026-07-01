<script setup>
import { inject, ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button, Skeleton, ConfirmDialog } from '@starling/ui'
import ListCard   from '@starling/ui/ListCard'
import ListHeader from '@starling/ui/ListHeader'
import ListItem   from '@starling/ui/ListItem'
import { useApi } from '../../composables/useApi.js'
import ManagePageHeader from './components/ManagePageHeader.vue'
import TrackTypeDialog  from './components/TrackTypeDialog.vue'

const route      = useRoute()
const { t }      = useI18n()
const data       = inject('production-data')
const { $fetch } = useApi()

const trackTypes  = ref([])
const sourceSets  = ref([])
const loading     = ref(false)
const error       = ref('')

// dialogs
const createOpen  = ref(false)
const editTarget  = ref(null)
const deleteTarget = ref(null)
const deleting    = ref(false)

async function load() {
  loading.value = true
  error.value   = ''
  const base = `/api/company/${route.params.cslug}/production/${route.params.pslug}`
  const [ttRes, ssRes] = await Promise.all([
    $fetch(`${base}/track-types`, { silent: true }),
    $fetch(`${base}/source-sets`, { silent: true }),
  ])
  loading.value = false
  if (!ttRes.ok) { error.value = t('trackTypes.couldNotLoad'); return }
  trackTypes.value = ttRes.data ?? []
  if (ssRes.ok) sourceSets.value = ssRes.data ?? []
}

onMounted(load)

function setName(id) {
  return sourceSets.value.find(s => s.id === id)?.name ?? '—'
}

function onCreated(tt)  { trackTypes.value.push(tt) }
function onUpdated(tt)  {
  const i = trackTypes.value.findIndex(x => x.id === tt.id)
  if (i !== -1) trackTypes.value[i] = tt
  editTarget.value = null
}

async function confirmDelete() {
  deleting.value = true
  const { ok } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/track-types/${deleteTarget.value.id}`,
    { method: 'DELETE' },
  )
  deleting.value = false
  if (ok) {
    trackTypes.value = trackTypes.value.filter(x => x.id !== deleteTarget.value.id)
    deleteTarget.value = null
  }
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

    <ListCard>
      <ListHeader :title="$t('trackTypes.title')">
        <template #action>
          <span
            v-if="!loading && trackTypes.length"
            class="text-xs tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md"
          >{{ trackTypes.length }}</span>
        </template>
      </ListHeader>

      <!-- Loading -->
      <ul v-if="loading" class="divide-y divide-border">
        <li v-for="i in 4" :key="i" class="flex items-center gap-3 px-4 py-3">
          <Skeleton class="size-3 rounded-full shrink-0" />
          <Skeleton class="h-4 flex-1 max-w-xs rounded" />
          <Skeleton class="h-5 w-14 rounded-full" />
          <Skeleton class="h-5 w-20 rounded-full" />
          <Skeleton class="size-7 rounded-md ml-auto" />
          <Skeleton class="size-7 rounded-md" />
        </li>
      </ul>

      <!-- Error -->
      <p v-else-if="error" class="px-4 py-4 text-sm text-destructive">{{ error }}</p>

      <!-- Empty -->
      <div v-else-if="trackTypes.length === 0" class="py-14 text-center text-sm text-muted-foreground">
        {{ $t('trackTypes.noTypes') }}
      </div>

      <!-- List -->
      <ul v-else class="divide-y divide-border">
        <ListItem v-for="tt in trackTypes" :key="tt.id">
          <!-- Color dot -->
          <span
            class="size-2.5 rounded-full shrink-0"
            :style="{ backgroundColor: tt.color ?? 'oklch(65% 0.18 250)' }"
          />
          <!-- Name -->
          <span class="flex-1 text-sm font-medium text-foreground truncate">{{ tt.name }}</span>
          <!-- Mode badge -->
          <span class="px-2 py-0.5 text-[11px] font-medium rounded-full bg-muted text-muted-foreground capitalize shrink-0">
            {{ tt.trackMode }}
          </span>
          <!-- Source set badge -->
          <span
            v-if="tt.sourceSetId"
            class="px-2 py-0.5 text-[11px] font-medium rounded-full bg-primary/10 text-primary shrink-0 max-w-28 truncate"
          >{{ setName(tt.sourceSetId) }}</span>
          <!-- Actions -->
          <button
            class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
            :title="$t('trackTypes.edit')"
            @click="editTarget = tt"
          >
            <Icon icon="mdi:pencil-outline" class="size-3.5" />
          </button>
          <button
            class="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-accent transition-colors shrink-0"
            :title="$t('trackTypes.delete')"
            @click="deleteTarget = tt"
          >
            <Icon icon="mdi:trash-can-outline" class="size-3.5" />
          </button>
        </ListItem>
      </ul>
    </ListCard>

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
