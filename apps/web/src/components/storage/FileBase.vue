<script setup>
import { Icon } from '@iconify/vue'

defineProps({ file: { type: Object, required: true } })
defineEmits(['select', 'delete'])
</script>

<template>
  <div class="group relative rounded-lg overflow-hidden hover:border-muted-foreground/30 transition-colors">

    <!-- Delete -->
    <button
      class="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded bg-destructive/10 hover:bg-destructive/25 text-destructive"
      title="Delete"
      @click.stop="$emit('delete', file)"
    >
      <Icon icon="mdi:trash-can-outline" class="text-base" />
    </button>

    <!-- Preview -->
    <button class="w-full aspect-video block overflow-hidden rounded-lg" @click="$emit('select', file)">
      <slot name="preview" />
    </button>

    <!-- Info -->
    <div class="px-0.5 py-2">
      <slot name="info" />
    </div>

  </div>
</template>
