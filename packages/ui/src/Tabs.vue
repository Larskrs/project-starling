<script setup>
import { Icon } from '@iconify/vue'

defineProps({
  tabs:       { type: Array,  required: true }, // [{ id, label, icon? }]
  modelValue: { type: String, required: true },
})

defineEmits(['update:modelValue'])
</script>

<template>
  <div class="flex border-b border-border">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      class="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors relative -mb-px border-b-2"
      :class="modelValue === tab.id
        ? 'text-foreground border-primary'
        : 'text-muted-foreground border-transparent hover:text-foreground hover:border-border'"
      @click="$emit('update:modelValue', tab.id)"
    >
      <Icon v-if="tab.icon" :icon="tab.icon" class="text-base shrink-0" />
      {{ tab.label }}
    </button>
  </div>
</template>
