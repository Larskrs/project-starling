<script setup>
import { cn } from './utils.js'

const props = defineProps({
  variant: { type: String, default: 'muted' }, // muted | primary
  class:   { type: String, default: '' },
})

const variants = {
  muted:   'bg-muted text-muted-foreground',
  primary: 'bg-primary/10 text-primary',
}
</script>

<template>
  <span
    :class="cn('px-2 py-0.5 text-[11px] font-medium rounded-full shrink-0', variants[props.variant], props.class)"
  >
    <slot />
  </span>
</template>
