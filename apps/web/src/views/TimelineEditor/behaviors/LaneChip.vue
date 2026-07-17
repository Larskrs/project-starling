<script setup>
import { ref } from 'vue'
import { Icon } from '@iconify/vue'
import { createDrag } from '../usePointerDrag.js'

// One draggable value chip on a strip lane (ruler labels, BPM changes).
// Drag horizontally to move the clip, click to edit, hover for delete.
// The default slot renders anchored decorations (e.g. a position tick).
const props = defineProps({
  clip:        { type: Object, required: true },
  x:           { type: Number, required: true },
  text:        { type: String, default: '—' },
  pxPerFrame:  { type: Number, required: true },
  minPosition: { type: Number, default: 0 },
})

const emit = defineEmits(['edit', 'delete', 'move'])

const hovered    = ref(false)
const dragging   = ref(false)
const dragOffset = ref(0)
let _didMove = false

const startDrag = createDrag({
  onStart: () => { _didMove = false; dragging.value = true; dragOffset.value = 0 },
  onMove:  ({ dx }) => { _didMove = true; dragOffset.value = dx },
  onEnd:   ({ dx, moved }) => {
    dragging.value   = false
    dragOffset.value = 0
    if (!moved) return
    const deltaFrames = Math.round(dx / props.pxPerFrame)
    const position    = Math.max(props.minPosition, props.clip.position + deltaFrames)
    if (deltaFrames !== 0) emit('move', { clip: props.clip, position })
  },
})

function onClick() {
  if (_didMove) { _didMove = false; return }
  emit('edit', props.clip)
}
</script>

<template>
  <div
    class="absolute flex items-center"
    :class="dragging ? 'z-20' : ''"
    :style="{ left: (x + (dragging ? dragOffset : 0)) + 'px' }"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <slot />

    <button
      type="button"
      class="ml-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold leading-none
             bg-background border border-border text-foreground hover:border-primary/60 transition-colors whitespace-nowrap touch-none"
      :class="dragging ? 'cursor-grabbing border-primary shadow-md' : 'cursor-grab'"
      @pointerdown.prevent="startDrag($event)"
      @click.stop="onClick"
    >
      {{ text }}
    </button>

    <button
      v-if="hovered && !dragging"
      type="button"
      class="ml-0.5 size-4 flex items-center justify-center rounded text-muted-foreground hover:text-destructive"
      @click.stop="$emit('delete', clip)"
    >
      <Icon icon="mdi:close" class="size-3" />
    </button>
  </div>
</template>
