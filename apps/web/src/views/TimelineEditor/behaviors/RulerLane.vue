<script setup>
import { computed } from 'vue'
import { clipLeft } from '../useEditorUtils.js'
import { useViewportRange } from '../useViewportRange.js'
import LaneChip from './LaneChip.vue'

// Slim strip lane for track types with trackDisplay: 'ruler'.
// Each clip renders as a compact chip at its position; the value applies until
// the next chip. Chips drag horizontally to move the clip.
// (Metronome tracks use BpmLane instead — metronome overrides trackDisplay.)
const props = defineProps({
  track:      { type: Object,  required: true },
  timeline:   { type: Object,  required: true },
  pxPerFrame: { type: Number,  required: true },
  height:     { type: Number,  default: 28 },
  selected:   { type: Boolean, default: false },
  muted:      { type: Boolean, default: false },
})

defineEmits(['select', 'edit-clip', 'delete-clip', 'move-clip'])

// Only chips near the viewport render (160px covers the widest chip label).
const range = useViewportRange(160)

const chips = computed(() => {
  const { left, right } = range.value
  const out = []
  for (const clip of props.track.clips) {
    const x = clipLeft(clip, props.timeline.startFrame, props.pxPerFrame)
    if (x < left || x > right) continue
    out.push({ clip, x, text: clip.label || '—' })
  }
  return out
})
</script>

<template>
  <div
    class="relative border-b border-border bg-muted/40"
    :class="muted ? 'opacity-50' : ''"
    :style="{ height: height + 'px' }"
  >
    <div
      class="absolute inset-0 transition-colors"
      :class="selected ? 'bg-primary/10' : ''"
      @click="$emit('select')"
    />

    <!-- Baseline -->
    <div class="absolute inset-x-0 top-1/2 h-px bg-border/60 pointer-events-none" />

    <LaneChip
      v-for="{ clip, x, text } in chips"
      :key="clip.id"
      class="top-1/2 -translate-y-1/2"
      :clip="clip"
      :x="x"
      :text="text"
      :px-per-frame="pxPerFrame"
      :min-position="timeline.startFrame"
      @edit="$emit('edit-clip', $event)"
      @delete="$emit('delete-clip', $event)"
      @move="$emit('move-clip', $event)"
    >
      <!-- Position tick -->
      <div class="absolute -left-px top-1/2 -translate-y-1/2 h-4 w-px bg-primary/70" />
    </LaneChip>
  </div>
</template>
