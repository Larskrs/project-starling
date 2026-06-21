<script setup>
import { Icon } from '@iconify/vue'
import Breadcrumb from '../ui/Breadcrumb.vue'

defineProps({
  items: { type: Array, required: true }, // [{ id, label }]
})

defineEmits(['navigate'])
</script>

<template>
  <Breadcrumb class="gap-0" :items="items">
    <template #default="{ item, index, isLast }">
      <button
        class="first:-ml-3 -ml-1 text-lg px-3 py-1 rounded-lg transition-colors truncate max-w-36"
        :class="isLast
          ? 'text-foreground font-medium pointer-events-none'
          : 'text-muted-foreground hover:text-foreground hover:bg-secondary/75'"
        @click="$emit('navigate', index)"
      >
        {{ item.label }}
      </button>
    </template>
    <template #separator>
      <Icon icon="mdi:chevron-right" class="text-xl -ml-1 text-muted-foreground/40 shrink-0" />
    </template>
  </Breadcrumb>
</template>
