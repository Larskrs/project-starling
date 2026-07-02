<script setup>
import { Icon } from '@iconify/vue'
import { cn } from './utils.js'

const props = defineProps({
  icon:        { type: String,  default: null },
  title:       { type: String,  default: '' },
  destructive: { type: Boolean, default: false },
  class:       { type: String,  default: '' },
})
</script>

<template>
  <button
    type="button"
    :title="title"
    :class="cn(
      'p-1.5 rounded-md text-muted-foreground hover:bg-accent transition-colors shrink-0',
      destructive ? 'hover:text-destructive' : 'hover:text-foreground',
      props.class,
    )"
  >
    <slot>
      <Icon v-if="icon" :icon="icon" class="size-3.5" />
    </slot>
  </button>
</template>
