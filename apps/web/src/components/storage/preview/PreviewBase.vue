<script setup>
import { Icon } from '@iconify/vue'

defineProps({
  file:    { type: Object,  required: true },
  hasPrev: { type: Boolean, default: false },
  hasNext: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'prev', 'next'])

function formatBytes(n) {
  if (n < 1024)        return `${n} B`
  if (n < 1024 ** 2)   return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 ** 2).toFixed(1)} MB`
}
</script>

<template>
  <div class="flex flex-col gap-3 w-full h-full">
    <div class="flex items-center gap-1 shrink-0">
      <button
        :disabled="!hasPrev"
        class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none transition-colors"
        title="Previous (←)"
        @click="emit('prev')"
      >
        <Icon icon="mdi:chevron-left" class="text-lg" />
      </button>
      <button
        :disabled="!hasNext"
        class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none transition-colors"
        title="Next (→)"
        @click="emit('next')"
      >
        <Icon icon="mdi:chevron-right" class="text-lg" />
      </button>
      <div class="flex-1 min-w-0 px-2">
        <p class="text-sm font-medium text-foreground truncate">{{ file.name }}</p>
        <p class="text-xs text-muted-foreground">{{ formatBytes(file.size) }}</p>
      </div>
      <button
        class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title="Close (Esc)"
        @click="emit('close')"
      >
        <Icon icon="mdi:close" class="text-lg" />
      </button>
    </div>
    <div class="flex-1 min-h-0">
      <slot />
    </div>
  </div>
</template>
