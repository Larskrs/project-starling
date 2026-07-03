<script setup>
import { cn } from '@starling/ui'

const props = defineProps({
  shortName: { type: String, default: '' },
  hue:       { type: Number, required: true },
  class:     { type: String, default: '' },
})
</script>

<template>
  <span
    :class="cn('inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-bold shrink-0 min-w-8', props.class)"
    :style="{
      backgroundColor: `oklch(70% 0.25 ${hue} / 0.75)`,
      color: `oklch(22% 0.05 ${hue})`,
    }"
  >{{ shortName || '—' }}</span>
</template>
