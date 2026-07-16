<script setup>
import { computed, inject, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { clipLeft } from '../useEditorUtils.js'

// Slim strip lane for track types with trackDisplay: 'ruler'.
// Each clip renders as a compact chip at its position; the value applies until
// the next chip. Chips can be dragged horizontally to move the clip.
// (Metronome tracks use BpmLane instead — metronome overrides trackDisplay.)
const props = defineProps({
  track:      { type: Object,  required: true },
  timeline:   { type: Object,  required: true },
  pxPerFrame: { type: Number,  required: true },
  height:     { type: Number,  default: 28 },
  selected:   { type: Boolean, default: false },
  muted:      { type: Boolean, default: false },
})

const emit = defineEmits(['select', 'edit-clip', 'delete-clip', 'move-clip'])

const hoveredId  = ref(null)
const dragId     = ref(null)
const dragOffset = ref(0)

const viewport = inject('editor-viewport', ref({ scrollLeft: 0, width: 0 }))

// Only chips near the viewport render (160px covers the widest chip label).
const chips = computed(() => {
  const viewL = viewport.value.scrollLeft - 160
  const viewR = viewport.value.scrollLeft + (viewport.value.width || 1600) + 32
  const out = []
  for (const clip of props.track.clips) {
    const x = clipLeft(clip, props.timeline.startFrame, props.pxPerFrame)
    if (x < viewL || x > viewR) continue
    out.push({ clip, x, text: clip.label || '—' })
  }
  return out
})

// ── Drag to move ──────────────────────────────────────────────────────────────
let _startX  = 0
let _didMove = false

function startDrag(clip, e) {
  if (e.button !== 0) return
  _startX  = e.clientX
  _didMove = false
  dragId.value     = clip.id
  dragOffset.value = 0
  const onMove = (ev) => {
    const dx = ev.clientX - _startX
    if (!_didMove && Math.abs(dx) > 3) _didMove = true
    if (_didMove) dragOffset.value = dx
  }
  const onUp = (ev) => {
    window.removeEventListener('pointermove', onMove)
    if (_didMove) {
      const deltaFrames = Math.round((ev.clientX - _startX) / props.pxPerFrame)
      const position    = Math.max(props.timeline.startFrame, clip.position + deltaFrames)
      if (deltaFrames !== 0) emit('move-clip', { clip, position })
    }
    dragId.value     = null
    dragOffset.value = 0
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp, { once: true })
}

function onChipClick(clip) {
  if (_didMove) { _didMove = false; return }
  emit('edit-clip', clip)
}
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

    <div
      v-for="{ clip, x, text } in chips"
      :key="clip.id"
      class="absolute top-1/2 -translate-y-1/2 flex items-center"
      :class="dragId === clip.id ? 'z-20' : ''"
      :style="{ left: (x + (dragId === clip.id ? dragOffset : 0)) + 'px' }"
      @mouseenter="hoveredId = clip.id"
      @mouseleave="hoveredId = null"
    >
      <!-- Tick -->
      <div class="absolute -left-px top-1/2 -translate-y-1/2 h-4 w-px bg-primary/70" />

      <button
        type="button"
        class="ml-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold leading-none
               bg-background border border-border text-foreground hover:border-primary/60 transition-colors whitespace-nowrap touch-none"
        :class="dragId === clip.id ? 'cursor-grabbing border-primary shadow-md' : 'cursor-grab'"
        @pointerdown.prevent="startDrag(clip, $event)"
        @click.stop="onChipClick(clip)"
      >
        {{ text }}
      </button>

      <button
        v-if="hoveredId === clip.id && dragId !== clip.id"
        type="button"
        class="ml-0.5 size-4 flex items-center justify-center rounded text-muted-foreground hover:text-destructive"
        @click.stop="$emit('delete-clip', clip)"
      >
        <Icon icon="mdi:close" class="size-3" />
      </button>
    </div>
  </div>
</template>
