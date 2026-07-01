<script setup>
import { inject, ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button, Skeleton, ConfirmDialog, SwitchTab } from '@starling/ui'
import ListCard   from '@starling/ui/ListCard'
import ListHeader from '@starling/ui/ListHeader'
import ListItem   from '@starling/ui/ListItem'
import { useApi } from '../../composables/useApi.js'
import ManagePageHeader from './components/ManagePageHeader.vue'
import SourceSetDialog  from './components/SourceSetDialog.vue'

const route      = useRoute()
const router     = useRouter()
const { t }      = useI18n()
const data       = inject('production-data')
const { $fetch } = useApi()

const sourceSets   = ref([])
const loading      = ref(false)
const error        = ref('')

const createOpen   = ref(false)
const renameTarget = ref(null)
const deleteTarget = ref(null)
const deleting     = ref(false)

async function load() {
  loading.value = true
  error.value   = ''
  const { ok, data: res } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/source-sets`,
    { silent: true },
  )
  loading.value = false
  if (!ok) { error.value = t('sourceSets.couldNotLoad'); return }
  sourceSets.value = res ?? []
}

onMounted(load)

function openDetail(id) {
  router.push(`/c/${route.params.cslug}/p/${route.params.pslug}/source-sets/${id}`)
}

function onCreated(s)  { sourceSets.value.push(s) }
function onUpdated(s)  {
  const i = sourceSets.value.findIndex(x => x.id === s.id)
  if (i !== -1) sourceSets.value[i] = s
  renameTarget.value = null
}

async function confirmDelete() {
  deleting.value = true
  const { ok } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/source-sets/${deleteTarget.value.id}`,
    { method: 'DELETE' },
  )
  deleting.value = false
  if (ok) {
    sourceSets.value = sourceSets.value.filter(x => x.id !== deleteTarget.value.id)
    deleteTarget.value = null
  }
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

    <ListCard>
      <ListHeader :title="$t('sourceSets.title')">
        <template #action>
          <span
            v-if="!loading && sourceSets.length"
            class="text-xs tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md"
          >{{ sourceSets.length }}</span>
        </template>
      </ListHeader>

      <!-- Loading -->
      <ul v-if="loading" class="divide-y divide-border">
        <li v-for="i in 3" :key="i" class="flex items-center gap-3 px-4 py-3">
          <Skeleton class="size-5 rounded shrink-0" />
          <Skeleton class="h-4 flex-1 max-w-xs rounded" />
          <Skeleton class="size-7 rounded-md ml-auto" />
          <Skeleton class="size-7 rounded-md" />
          <Skeleton class="size-7 rounded-md" />
        </li>
      </ul>

      <!-- Error -->
      <p v-else-if="error" class="px-4 py-4 text-sm text-destructive">{{ error }}</p>

      <!-- Empty -->
      <div v-else-if="sourceSets.length === 0" class="py-14 text-center text-sm text-muted-foreground">
        {{ $t('sourceSets.noSets') }}
      </div>

      <!-- List -->
      <ul v-else class="divide-y divide-border">
        <ListItem v-for="s in sourceSets" :key="s.id">
          <Icon icon="mdi:layers-outline" class="size-4 text-muted-foreground shrink-0" />
          <button
            class="flex-1 text-left text-sm font-medium text-foreground hover:text-primary transition-colors truncate"
            @click="openDetail(s.id)"
          >
            {{ s.name }}
          </button>
          <!-- Open -->
          <button
            class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
            :title="$t('sourceSets.openSet')"
            @click="openDetail(s.id)"
          >
            <Icon icon="mdi:chevron-right" class="size-3.5" />
          </button>
          <!-- Rename -->
          <button
            class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
            :title="$t('sourceSets.rename')"
            @click="renameTarget = s"
          >
            <Icon icon="mdi:pencil-outline" class="size-3.5" />
          </button>
          <!-- Delete -->
          <button
            class="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-accent transition-colors shrink-0"
            :title="$t('sourceSets.delete')"
            @click="deleteTarget = s"
          >
            <Icon icon="mdi:trash-can-outline" class="size-3.5" />
          </button>
        </ListItem>
      </ul>
    </ListCard>

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
