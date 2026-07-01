<script setup>
import { cn } from './utils.js'

const props = defineProps({
  modelValue: { required: true },
  options:    { type: Array, required: true }, // [{ value, label }]
  class:      { type: String, default: '' },
})

defineEmits(['update:modelValue'])
</script>

<template>
  <div :class="cn('inline-flex items-center gap-0.5 rounded-lg bg-background p-1', props.class)">
    <button
      v-for="opt in options"
      :key="String(opt.value)"
      type="button"
      class="px-3 py-1 rounded-md text-sm font-medium transition-all duration-150"
      :class="modelValue === opt.value
        ? 'bg-secondary text-foreground shadow-sm'
        : 'text-muted-foreground hover:text-foreground'"
      @click="$emit('update:modelValue', opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
