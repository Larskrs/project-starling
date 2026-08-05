<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import { Icon } from '@iconify/vue'
import { Button, EmptyState, IconButton } from '@starling/ui'
import WaveformPlayer from '../audio/WaveformPlayer.vue'
import { useStorage } from './storage.js'
import { fileUrl } from './useStorageApi.js'
import { formatBytes } from '../../lib/utils.js'

/**
 * Full-screen preview of the open file, with the arrow keys stepping through
 * its siblings. Mounted only while something is open, so the key handler is
 * bound for exactly as long as it applies.
 */
const { preview } = useStorage()
const { file, hasPrev, hasNext, close, prev, next } = preview

function onKeydown(e) {
  const handler = { Escape: close, ArrowLeft: prev, ArrowRight: next }[e.key]
  if (!handler) return
  e.preventDefault()
  handler()
}

onMounted(()       => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="fixed inset-0 z-20 p-6 flex flex-col">
    <div class="fixed inset-0 bg-background/85 backdrop-blur-sm" @click="close()" />

    <div class="relative z-10 flex flex-1 min-h-0 flex-col gap-3">
      <div class="flex items-center gap-1 shrink-0">
        <IconButton
          icon="mdi:chevron-left"
          :disabled="!hasPrev"
          :title="$t('storage.preview.previous')"
          @click="prev()"
        />
        <IconButton
          icon="mdi:chevron-right"
          :disabled="!hasNext"
          :title="$t('storage.preview.next')"
          @click="next()"
        />
        <div class="flex-1 min-w-0 px-2">
          <p class="text-sm font-medium text-foreground truncate">{{ file.name }}</p>
          <p class="text-xs text-muted-foreground">{{ formatBytes(file.size) }}</p>
        </div>
        <IconButton icon="mdi:close" :title="$t('storage.preview.close')" @click="close()" />
      </div>

      <div class="flex-1 min-h-0">
        <div
          v-if="file.type === 'image'"
          class="w-full h-full flex items-center justify-center rounded-lg overflow-hidden bg-muted/20"
        >
          <img
            :key="file.id"
            :src="fileUrl(file.id)"
            :alt="file.name"
            class="max-w-full max-h-full object-contain rounded"
            draggable="false"
          />
        </div>

        <div
          v-else-if="file.type === 'audio'"
          class="w-full h-full flex items-center justify-center rounded-lg bg-muted/20 p-6"
        >
          <WaveformPlayer :key="file.id" :src="fileUrl(file.id)" class="w-full max-w-lg" />
        </div>

        <EmptyState v-else icon="mdi:file-outline" class="h-full gap-4 rounded-lg bg-muted/20">
          {{ $t('storage.preview.unavailable') }}
          <template #action>
            <Button as="a" size="sm" :href="fileUrl(file.id)" download>
              <Icon icon="mdi:download" class="text-base" />
              {{ $t('storage.preview.download') }}
            </Button>
          </template>
        </EmptyState>
      </div>
    </div>
  </div>
</template>
