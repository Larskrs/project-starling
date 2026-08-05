<script setup>
import { Icon } from '@iconify/vue'
import { Avatar } from '@starling/ui'

/**
 * Full-screen cover shown from the moment a timeline is opened until the editor
 * has its data and has restored the saved view.
 *
 * Lives outside the editor's lazy chunk (App.vue renders it) — the chunk
 * downloading is one of the waits it exists to cover.
 */
defineProps({
  timeline: { type: Object, default: null },   // { id, name?, profileImageId? }
})
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-background">
    <Avatar :id="timeline?.profileImageId" class="size-20 rounded-2xl shadow-sm">
      <Icon icon="mdi:movie-open-outline" class="size-9 text-muted-foreground/70" />
    </Avatar>

    <div class="flex flex-col items-center gap-1.5 px-6 text-center">
      <p class="max-w-sm truncate text-base font-semibold text-foreground">
        {{ timeline?.name || $t('editor.loading.untitled') }}
      </p>
      <p class="text-sm text-muted-foreground">{{ $t('editor.loading.opening') }}</p>
    </div>

    <!-- Indeterminate: the wait is a chunk download plus a query, and neither
         reports progress worth showing as a percentage. -->
    <div class="h-1 w-48 overflow-hidden rounded-full bg-muted">
      <div class="timeline-loading-bar h-full w-1/3 rounded-full bg-primary" />
    </div>
  </div>
</template>

<style scoped>
.timeline-loading-bar {
  animation: timeline-loading 1.1s ease-in-out infinite;
}

@keyframes timeline-loading {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}

@media (prefers-reduced-motion: reduce) {
  .timeline-loading-bar {
    animation: none;
    width: 100%;
    opacity: 0.5;
  }
}
</style>
