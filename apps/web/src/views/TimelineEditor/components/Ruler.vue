<script setup>
import { computed } from 'vue'
import { framesToTC, rulerInterval } from '../useEditorUtils.js'

const props = defineProps({
  timeline:      { type: Object, required: true },
  pxPerFrame:    { type: Number, required: true },
  playheadFrame: { type: Number, required: true },
})

const emit = defineEmits(['scrub'])

const marks = computed(() => {
  const { startFrame, endFrame } = props.timeline
  const interval = rulerInterval(props.pxPerFrame)
  const first    = Math.ceil(startFrame / interval) * interval
  const result   = []
  for (let f = first; f <= endFrame; f += interval) {
    result.push({ frame: f, x: (f - startFrame) * props.pxPerFrame })
  }
  return result
})

function label(frame) {
  return framesToTC(frame, props.timeline.frameRate)
}

const playheadX = computed(() =>
  (props.playheadFrame - props.timeline.startFrame) * props.pxPerFrame,
)
</script>

<template>
  <div
    class="sticky top-0 z-10 h-8 border-b border-border bg-muted/60 backdrop-blur select-none cursor-crosshair overflow-hidden relative shrink-0 touch-none"
    @pointerdown.prevent="$emit('scrub', $event)"
  >
    <!-- Frame marks -->
    <div
      v-for="mark in marks"
      :key="mark.frame"
      class="absolute top-0 bottom-0 flex flex-col items-start"
      :style="{ left: mark.x + 'px' }"
    >
      <!-- Tick line -->
      <div class="w-px bg-border/60 absolute inset-y-0" />
      <!-- Label -->
      <span class="absolute top-1 left-1 text-[10px] font-mono text-muted-foreground/70 whitespace-nowrap leading-none">
        {{ label(mark.frame) }}
      </span>
    </div>

    <!-- Playhead indicator on ruler -->
    <div
      class="absolute top-0 bottom-0 w-px bg-primary pointer-events-none"
      :style="{ left: playheadX + 'px' }"
    />
    <div
      class="absolute top-0 size-2 bg-primary rounded-sm pointer-events-none"
      :style="{ left: (playheadX - 4) + 'px' }"
    />
  </div>
</template>
