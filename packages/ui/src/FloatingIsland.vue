<script setup>
import { cn } from './utils.js'

// Floating panel anchored bottom-center of the nearest positioned ancestor
// (give the parent `relative`). Slot-based:
//   #header  — leading header content (falls back to `title`)
//   #actions — trailing header controls (close button, etc.)
//   default  — panel body
// The header row renders only when a title or one of the header slots is given.
const props = defineProps({
  title: { type: String, default: '' },
  class: { type: String, default: '' },
})
</script>

<template>
  <div class="pointer-events-none absolute inset-x-0 bottom-[25%] z-30 flex justify-center px-4">
    <div
      :class="cn(
        'pointer-events-auto flex flex-col rounded-2xl border border-border bg-popover/95 backdrop-blur-md shadow-2xl min-w-80 max-w-[min(90vw,40rem)] overflow-hidden',
        props.class,
      )"
    >
      <div
        v-if="title || $slots.header || $slots.actions"
        class="flex items-center gap-3 px-4 py-2.5 border-b border-border/60 bg-muted/30"
      >
        <slot name="header">
          <span class="text-sm font-semibold text-foreground truncate">{{ title }}</span>
        </slot>
        <div class="flex-1" />
        <slot name="actions" />
      </div>

      <div class="px-4 py-3">
        <slot />
      </div>
    </div>
  </div>
</template>
