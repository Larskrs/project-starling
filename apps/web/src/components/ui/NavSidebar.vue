<script setup>
import { Icon } from '@iconify/vue'

defineProps({
  items:      { type: Array,  required: true }, // [{ id, label, icon? }]
  modelValue: { type: String, required: true },
})

defineEmits(['update:modelValue'])
</script>

<template>
  <nav class="flex flex-col gap-0.5">
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors w-full text-left"
      :class="modelValue === item.id
        ? 'bg-secondary text-foreground'
        : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'"
      @click="$emit('update:modelValue', item.id)"
    >
      <Icon v-if="item.icon" :icon="item.icon" class="text-base shrink-0" />
      {{ item.label }}
    </button>
  </nav>
</template>
