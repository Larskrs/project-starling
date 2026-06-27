<script setup>
import { DropdownMenuPortal, DropdownMenuContent } from 'radix-vue'

defineProps({
  side:       { type: String, default: 'bottom' },
  align:      { type: String, default: 'start'  },
  sideOffset: { type: Number, default: 4         },
})
</script>

<template>
  <DropdownMenuPortal>
    <DropdownMenuContent
      :side="side"
      :align="align"
      :side-offset="sideOffset"
      class="z-[200] bg-background min-w-44 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl py-1 outline-none"
    >
      <slot />
    </DropdownMenuContent>
  </DropdownMenuPortal>
</template>

<style>
/* Open animation — targets Radix portal content on mount */
[data-radix-popper-content-wrapper] [role="menu"][data-state="open"] {
  animation: ddm-open 0.1s ease;
}
[data-radix-popper-content-wrapper] [role="menu"][data-state="closed"] {
  animation: ddm-close 0.08s ease forwards;
}
@keyframes ddm-open  { from { opacity: 0; transform: scale(0.96) translateY(-4px); } to { opacity: 1; transform: scale(1) translateY(0); } }
@keyframes ddm-close { from { opacity: 1; }  to { opacity: 0; } }
</style>
