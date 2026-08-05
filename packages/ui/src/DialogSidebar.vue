<script setup>
import { Icon } from '@iconify/vue'
import { cn } from './utils.js'

/**
 * Page rail for SettingsDialog. Vertical alongside the content on sm+, a
 * horizontal scroller above it on narrow screens.
 */
const props = defineProps({
  items:      { type: Array,  required: true },  // [{ id, label, icon?, invalid? }]
  modelValue: { type: String, default: '' },
  class:      { type: String, default: '' },
})

defineEmits(['update:modelValue'])
</script>

<template>
  <nav
    :class="cn(
      'flex shrink-0 gap-1 overflow-x-auto px-4 py-3',
      'sm:w-44 sm:flex-col sm:overflow-x-hidden sm:overflow-y-auto sm:px-2.5 sm:py-4',
      props.class
    )"
  >
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition-colors sm:w-full"
      :class="modelValue === item.id
        ? 'bg-secondary font-medium text-foreground'
        : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'"
      @click="$emit('update:modelValue', item.id)"
    >
      <Icon v-if="item.icon" :icon="item.icon" class="shrink-0 text-base" />
      <span class="truncate">{{ item.label }}</span>
      <span
        v-if="item.invalid"
        class="size-1.5 shrink-0 rounded-full bg-destructive sm:ml-auto"
        aria-hidden="true"
      />
    </button>
  </nav>
</template>
