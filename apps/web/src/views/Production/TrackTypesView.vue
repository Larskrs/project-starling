<script setup>
import { inject, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Badge, Button, IconButton, ListItem, Skeleton } from '@starling/ui'
import { useApi } from '../../composables/useApi.js'
import { useProductionCrud } from '../../composables/useProductionCrud.js'
import ManageListPage        from './components/ManageListPage.vue'
import TrackTypeDialog       from './components/TrackTypeDialog.vue'
import TrackTypePresetDialog from './components/TrackTypePresetDialog.vue'

const { t }      = useI18n()
const data       = inject('production-data')
const { $fetch } = useApi()

const {
  items: trackTypes, loading, error, load: loadTrackTypes,
  createOpen, editTarget, deleteTarget, deleting,
  onCreated, onUpdated, confirmDelete,
} = useProductionCrud('track-types', { loadError: () => t('trackTypes.couldNotLoad') })

const sourceSets = ref([])
const presets    = ref([])
const presetOpen = ref(false)

onMounted(() => {
  loadTrackTypes()
  $fetch(`/api/production/${data.value?.production?.id}/source-sets`, { silent: true })
    .then(({ ok, data: res }) => { if (ok) sourceSets.value = res ?? [] })
  $fetch(`/api/production/${data.value?.production?.id}/track-type-presets`, { silent: true })
    .then(({ ok, data: res }) => { if (ok) presets.value = res ?? [] })
})

function setName(id) {
  return sourceSets.value.find(s => s.id === id)?.name ?? '—'
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1)
</script>

<template>
  <ManageListPage
    :title="$t('trackTypes.title')"
    :description="$t('trackTypes.description', { production: data?.production?.name })"
    :loading="loading"
    :error="error"
    :count="trackTypes.length"
    :skeleton-rows="4"
    :delete-target="deleteTarget"
    :deleting="deleting"
    :delete-title="$t('trackTypes.confirmDeleteTitle')"
    :delete-label="$t('trackTypes.delete')"
    :cancel-label="$t('trackTypes.cancel')"
    :delete-message="$t('trackTypes.confirmDelete', { name: deleteTarget?.name })"
    @confirm-delete="confirmDelete"
    @cancel-delete="deleteTarget = null"
  >
    <template #action>
      <div class="flex items-center gap-2">
        <Button v-if="presets.length" size="sm" variant="outline" @click="presetOpen = true">
          <Icon icon="mdi:shape-plus-outline" class="text-base" />
          {{ $t('trackTypes.presets.fromPreset') }}
        </Button>
        <Button size="sm" @click="createOpen = true">
          <Icon icon="mdi:plus" class="text-base" />
          {{ $t('trackTypes.addType') }}
        </Button>
      </div>
    </template>

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
      <!-- Icon in the type's colour, or a plain dot when it has none -->
      <Icon
        v-if="tt.icon"
        :icon="tt.icon"
        class="size-4 shrink-0"
        :style="{ color: `oklch(65% 0.18 ${tt.hue ?? 250})` }"
      />
      <span
        v-else
        class="size-2.5 rounded-full shrink-0"
        :style="{ backgroundColor: `oklch(65% 0.18 ${tt.hue ?? 250})` }"
      />
      <span class="flex-1 text-sm font-medium text-foreground truncate">{{ tt.name }}</span>
      <Badge>{{ tt.trackMode === 'event' ? $t('trackTypes.modeEvent') : $t('trackTypes.modeClip') }}</Badge>
      <Badge v-if="tt.trackDisplay === 'ruler' && !tt.metronome">{{ $t('trackTypes.settings.displayRuler') }}</Badge>
      <Badge v-if="tt.nameDisplay && tt.nameDisplay !== 'normal'">
        {{ tt.nameDisplay === 'stretch' ? $t('trackTypes.settings.nameStretch') : $t('trackTypes.settings.nameEmphasize') }}
      </Badge>
      <Badge v-if="tt.clipDisplay && tt.clipDisplay !== 'normal'">
        {{ $t(`trackTypes.settings.clip${capitalize(tt.clipDisplay)}`) }}
      </Badge>
      <Badge v-if="tt.metronome">BPM</Badge>
      <Badge v-if="tt.tts">TTS</Badge>
      <Badge v-if="tt.sourceSetId" variant="primary" class="max-w-28 truncate">{{ setName(tt.sourceSetId) }}</Badge>
      <IconButton icon="mdi:pencil-outline" :title="$t('trackTypes.edit')" @click="editTarget = tt" />
      <IconButton icon="mdi:trash-can-outline" destructive :title="$t('trackTypes.delete')" @click="deleteTarget = tt" />
    </ListItem>

    <template #dialogs>
      <TrackTypeDialog
        :open="createOpen"
        :source-sets="sourceSets"
        @update:open="createOpen = $event"
        @created="onCreated"
      />
      <TrackTypePresetDialog
        :open="presetOpen"
        :presets="presets"
        @update:open="presetOpen = $event"
        @created="onCreated"
        @set-created="sourceSets.push($event)"
      />
      <TrackTypeDialog
        :open="editTarget !== null"
        :track-type="editTarget"
        :source-sets="sourceSets"
        @update:open="!$event && (editTarget = null)"
        @updated="onUpdated"
      />
    </template>
  </ManageListPage>
</template>
