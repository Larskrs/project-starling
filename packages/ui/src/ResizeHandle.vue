<script setup>
import { cn } from './utils.js'

// Thin grab strip for drag-resizing. Position it with a class (flex child or
// absolute edge) and wire @pointerdown to a useResizable().start call.
// axis 'x' resizes widths (vertical bar), 'y' resizes heights (horizontal bar).
const props = defineProps({
  axis:   { type: String,  default: 'x' },
  active: { type: Boolean, default: false },
  class:  { type: String,  default: '' },
})
</script>

<template>
  <div
    :class="cn(
      'shrink-0 z-20 touch-none transition-colors hover:bg-primary/50',
      axis === 'x' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize',
      active && 'bg-primary/60',
      props.class,
    )"
  />
</template>
