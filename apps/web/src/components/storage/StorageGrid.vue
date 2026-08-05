<script setup>
import { computed } from 'vue'
import { EmptyState, Spinner } from '@starling/ui'
import FolderTile from './FolderTile.vue'
import FileTile   from './FileTile.vue'
import { useStorage } from './storage.js'

/** Folders then files, in a grid that reflows to the available width. */
const props = defineProps({
  /** Grid column floor in px — narrower tiles when the browser is in a dialog. */
  tileWidth: { type: Number, default: 230 },
})

const { browser } = useStorage()
const { folders, visibleFiles, loading, failed, isEmpty } = browser

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(auto-fill, minmax(${props.tileWidth}px, 1fr))`,
}))
</script>

<template>
  <div class="flex flex-col gap-4">
    <div v-if="loading" class="py-8 text-center">
      <Spinner class="text-2xl text-muted-foreground/50" />
    </div>

    <p v-else-if="failed" class="text-sm text-destructive">{{ $t('storage.couldNotLoad') }}</p>

    <EmptyState v-else-if="isEmpty" icon="mdi:folder-open-outline" bordered>
      {{ $t('storage.empty') }}
    </EmptyState>

    <template v-else>
      <section v-if="folders.length" class="flex flex-col gap-2">
        <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider">{{ $t('storage.folders') }}</p>
        <div class="grid gap-2" :style="gridStyle">
          <FolderTile v-for="folder in folders" :key="folder.id" :folder="folder" />
        </div>
      </section>

      <section v-if="visibleFiles.length" class="flex flex-col gap-2">
        <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider">{{ $t('storage.files') }}</p>
        <div class="grid gap-2" :style="gridStyle">
          <FileTile v-for="file in visibleFiles" :key="file.id" :file="file" />
        </div>
      </section>
    </template>
  </div>
</template>
