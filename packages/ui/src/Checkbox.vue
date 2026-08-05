<script setup>
import { Icon } from '@iconify/vue'
import { cn } from './utils'

/**
 * Presentational checkbox — it draws the box and nothing else, so the caller
 * decides what the hit target is (a whole row, a tile corner, a label).
 */
const props = defineProps({
  checked: { type: Boolean, default: false },
  class:   { type: String,  default: '' },
})
</script>

<template>
  <span
    :class="cn(
      'flex items-center justify-center size-5 rounded border-2 transition-colors',
      checked
        ? 'bg-primary border-primary text-primary-foreground'
        : 'bg-background/80 border-muted-foreground/60 hover:border-primary',
      props.class,
    )"
  >
    <Icon v-if="checked" icon="mdi:check" class="text-[10px]" />
  </span>
</template>
