<script setup>
import { DialogPortal, DialogOverlay, DialogContent, DialogClose } from 'radix-vue'
import { Icon } from '@iconify/vue'
import { cn } from './utils.js'

const props = defineProps({
  class: { type: String, default: '' },
})
</script>

<template>
  <!--
    The overlay is both the backdrop and the centering flex container.
    This avoids the transform-centering conflict where CSS animation keyframes
    override the Tailwind translate utilities, causing the dialog to jump.
  -->
  <DialogPortal>
    <DialogOverlay
      class="dialog-overlay fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <DialogContent
        :class="cn(
          'relative w-full bg-card border border-border rounded-lg shadow-xl outline-none',
          props.class
        )"
      >
        <slot />
        <DialogClose
          class="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <Icon icon="mdi:close" class="size-4" />
          <span class="sr-only">Close</span>
        </DialogClose>
      </DialogContent>
    </DialogOverlay>
  </DialogPortal>
</template>

<style>
/* Overlay: fades in/out. Being the flex container it also reveals/hides the content. */
.dialog-overlay[data-state="open"]   { animation: dialog-overlay-in  0.15s ease; }
.dialog-overlay[data-state="closed"] { animation: dialog-overlay-out 0.12s ease forwards; }

/* Content: scales + slight y-slide. No opacity here — the overlay handles that. */
[role="dialog"][data-state="open"]   { animation: dialog-content-in  0.15s ease; }
[role="dialog"][data-state="closed"] { animation: dialog-content-out 0.12s ease forwards; }

@keyframes dialog-overlay-in  { from { opacity: 0; }  to { opacity: 1; } }
@keyframes dialog-overlay-out { from { opacity: 1; }  to { opacity: 0; } }
@keyframes dialog-content-in  { from { transform: scale(0.96) translateY(8px); }  to { transform: none; } }
@keyframes dialog-content-out { from { transform: none; }  to { transform: scale(0.96) translateY(8px); } }
</style>
