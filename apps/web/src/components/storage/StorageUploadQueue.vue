<script setup>
import { Icon } from '@iconify/vue'
import { Spinner } from '@starling/ui'
import { useStorage } from './storage'

/** In-flight uploads, however they were started — the button or a drop. */
const { upload } = useStorage()
const { queue } = upload

const STATUS_ICON = { done: 'mdi:check-circle-outline', error: 'mdi:alert-circle-outline' }
const STATUS_CLASS = { done: 'text-green-500', error: 'text-destructive' }
</script>

<template>
  <TransitionGroup v-if="queue.length" tag="ul" name="queue" class="flex flex-col gap-1">
    <li
      v-for="item in queue"
      :key="item.id"
      class="flex items-center gap-2.5 px-3 py-2 rounded-md border border-border bg-card text-sm"
    >
      <Spinner v-if="!STATUS_ICON[item.status]" class="text-base text-muted-foreground" />
      <Icon v-else :icon="STATUS_ICON[item.status]" class="text-base shrink-0" :class="STATUS_CLASS[item.status]" />
      <span class="flex-1 truncate text-foreground">{{ item.name }}</span>
      <span class="text-xs text-muted-foreground capitalize shrink-0">{{ $t(`storage.upload.${item.status}`) }}</span>
    </li>
  </TransitionGroup>
</template>

<style scoped>
.queue-enter-active, .queue-leave-active { transition: opacity 0.2s, transform 0.2s; }
.queue-enter-from,   .queue-leave-to     { opacity: 0; transform: translateY(-4px); }
</style>
