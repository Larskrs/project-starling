<script setup>
import { inject, ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button, Skeleton, ConfirmDialog } from '@starling/ui'
import ListCard   from '@starling/ui/ListCard'
import ListHeader from '@starling/ui/ListHeader'
import ListItem   from '@starling/ui/ListItem'
import { useApi } from '../../composables/useApi.js'
import ManagePageHeader from './components/ManagePageHeader.vue'
import SourceDialog     from './components/SourceDialog.vue'

const route      = useRoute()
const router     = useRouter()
const { t }      = useI18n()
const data       = inject('production-data')
const { $fetch } = useApi()

const setId   = computed(() => route.params.setId)
const setName = ref('')
const sources  = ref([])
const loading  = ref(false)
const error    = ref('')

const createOpen   = ref(false)
const editTarget   = ref(null)
const deleteTarget = ref(null)
const deleting     = ref(false)

async function load() {
  loading.value = true
  error.value   = ''
  const base = `/api/company/${route.params.cslug}/production/${route.params.pslug}`
  const [setsRes, sourcesRes] = await Promise.all([
    $fetch(`${base}/source-sets`, { silent: true }),
    $fetch(`${base}/source-sets/${setId.value}/sources`, { silent: true }),
  ])
  loading.value = false
  if (!setsRes.ok) { error.value = t('sources.couldNotLoad'); return }
  setName.value = setsRes.data?.find(s => s.id === setId.value)?.name ?? ''
  if (!sourcesRes.ok) { error.value = t('sources.couldNotLoad'); return }
  sources.value = sourcesRes.data ?? []
}

onMounted(load)

function goBack() {
  router.push(`/c/${route.params.cslug}/p/${route.params.pslug}/source-sets`)
}

function onCreated(s)  { sources.value.push(s) }
function onUpdated(s)  {
  const i = sources.value.findIndex(x => x.id === s.id)
  if (i !== -1) sources.value[i] = s
  editTarget.value = null
}

async function confirmDelete() {
  deleting.value = true
  const { ok } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/source-sets/${setId.value}/sources/${deleteTarget.value.id}`,
    { method: 'DELETE' },
  )
  deleting.value = false
  if (ok) {
    sources.value = sources.value.filter(x => x.id !== deleteTarget.value.id)
    deleteTarget.value = null
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto px-6 py-8 flex flex-col gap-5">

    <ManagePageHeader>
      <template #back>
        <button
          class="mt-0.5 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
          :title="$t('sources.backToSets')"
          @click="goBack"
        >
          <Icon icon="mdi:arrow-left" class="size-4" />
        </button>
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

    <ListCard>
      <ListHeader :title="$t('sources.title')">
        <template #action>
          <span
            v-if="!loading && sources.length"
            class="text-xs tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md"
          >{{ sources.length }}</span>
        </template>
      </ListHeader>

      <!-- Loading -->
      <ul v-if="loading" class="divide-y divide-border">
        <li v-for="i in 4" :key="i" class="flex items-center gap-3 px-4 py-3">
          <Skeleton class="h-5 w-8 rounded shrink-0" />
          <Skeleton class="h-4 flex-1 max-w-xs rounded" />
          <Skeleton class="size-7 rounded-md ml-auto" />
          <Skeleton class="size-7 rounded-md" />
        </li>
      </ul>

      <!-- Error -->
      <p v-else-if="error" class="px-4 py-4 text-sm text-destructive">{{ error }}</p>

      <!-- Empty -->
      <div v-else-if="sources.length === 0" class="py-14 text-center text-sm text-muted-foreground">
        {{ $t('sources.noSources') }}
      </div>

      <!-- List -->
      <ul v-else class="divide-y divide-border">
        <ListItem v-for="s in sources" :key="s.id">
          <!-- Hue badge -->
          <span
            class="inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-bold shrink-0 min-w-8"
            :style="{
              backgroundColor: `oklch(70% 0.25 ${s.hue} / 0.75)`,
              color: `oklch(22% 0.05 ${s.hue})`,
            }"
          >{{ s.shortName }}</span>
          <!-- Name -->
          <span class="flex-1 text-sm font-medium text-foreground truncate">{{ s.name }}</span>
          <!-- Actions -->
          <button
            class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
            :title="$t('sources.edit')"
            @click="editTarget = s"
          >
            <Icon icon="mdi:pencil-outline" class="size-3.5" />
          </button>
          <button
            class="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-accent transition-colors shrink-0"
            :title="$t('sources.delete')"
            @click="deleteTarget = s"
          >
            <Icon icon="mdi:trash-can-outline" class="size-3.5" />
          </button>
        </ListItem>
      </ul>
    </ListCard>

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
