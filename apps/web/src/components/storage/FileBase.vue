<script setup>
import { Icon } from '@iconify/vue'

defineProps({ file: { type: Object, required: true } })
defineEmits(['select', 'delete'])
</script>

<template>
  <div class="group relative rounded-lg border-2 border-border/50 hover:border-border overflow-hidden hover:border-muted-foreground/30 transition-colors">

    <!-- Delete -->
    <button
      class="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded bg-background/80 backdrop-blur-sm hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
      title="Delete"
      @click.stop="$emit('delete', file)"
    >
      <Icon icon="mdi:trash-can-outline" class="text-sm" />
    </button>

    <!-- Preview -->
    <button class="w-full aspect-square block overflow-hidden" @click="$emit('select', file)">
      <slot name="preview" />
    </button>

    <!-- Info -->
    <div class="px-2.5 py-2 bg-card">
      <slot name="info" />
    </div>

  </div>
</template>
