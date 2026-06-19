<script setup>
import { Icon } from '@iconify/vue'

defineProps({ folder: { type: Object, required: true } })
defineEmits(['open'])
</script>

<template>
  <button
    class="group flex items-center gap-3 w-full px-3 py-2.5 rounded-xl border border-border bg-muted/30 hover:bg-muted/70 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    @click="$emit('open', folder)"
  >
    <Icon icon="mdi:folder" class="text-amber-400 text-xl shrink-0" />
    <span class="text-sm font-medium text-foreground truncate">{{ folder.name }}</span>
  </button>
</template>
