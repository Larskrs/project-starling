<script setup>
import { computed } from 'vue'
import { clipWidth } from '../lib/editorUtils'
import { useViewportRange } from '../view/useViewportRange'
import EditorClip from './EditorClip.vue'

const props = defineProps({
  track:          { type: Object,  required: true },
  timeline:       { type: Object,  required: true },
  pxPerFrame:     { type: Number,  required: true },
  height:         { type: Number,  default: 48 },
  selected:       { type: Boolean, default: false },
  muted:          { type: Boolean, default: false },
  nameDisplay:    { type: String,  default: 'normal' },
  clipDisplay:    { type: String,  default: 'normal' },
  selectedClipIds: { type: Array,  default: () => [] },
  /** Shown in an empty lane, e.g. how to add the first clip. */
  emptyHint:      { type: String,  default: '' },
})

const emit = defineEmits(['select', 'select-clip', 'add-at', 'edit-clip', 'delete-clip', 'crop-clip', 'move-clip'])

// Only clips whose effective span intersects the viewport (+margin) mount —
// a long timeline can hold hundreds of clips but only the on-screen ones cost
// DOM. Width mirrors EditorClip's geometry: event clips run until the next
// clip, source-backed clip-mode clips are point markers, the rest use clipWidth.
// The selected clip is exempt: a drag selects it, and auto-scroll can carry its
// committed position out of range while the pointer is still down.
const range = useViewportRange(300)

const visibleClips = computed(() => {
  const px      = props.pxPerFrame
  const start   = props.timeline.startFrame
  const isEvent = props.track.mode === 'event'
  const clips   = props.track.clips
  const { left: viewL, right: viewR } = range.value

  const out = []
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]
    const next = clips[i + 1]?.position ?? props.timeline.endFrame
    const left = (clip.position - start) * px
    const width = isEvent
      ? Math.max(px, (next - clip.position) * px)
      : (clip.sourceId != null ? Math.max(2, px) : clipWidth(clip, px))
    if ((left + width < viewL || left > viewR) && !props.selectedClipIds.includes(clip.id)) continue
    out.push({ clip, next })
  }
  return out
})

// The hint follows the viewport so it is readable wherever the lane is scrolled.
const hintRange = useViewportRange(0)

// Double-clicking empty lane space adds a clip right there.
function onBackgroundDblClick(e) {
  const rect = e.currentTarget.getBoundingClientRect()
  emit('add-at', props.timeline.startFrame + (e.clientX - rect.left) / props.pxPerFrame)
}
</script>

<template>
  <div
    class="relative border-b border-border"
    :class="muted ? 'opacity-50' : ''"
    :style="{ height: height + 'px' }"
  >
    <div
      class="absolute inset-0 transition-colors"
      :class="selected ? 'bg-primary/10' : 'bg-muted/10'"
      @click="$emit('select')"
      @dblclick="onBackgroundDblClick"
    />

    <span
      v-if="emptyHint && track.clips.length === 0"
      class="absolute top-1/2 -translate-y-1/2 text-xs text-muted-foreground/60 whitespace-nowrap pointer-events-none select-none"
      :style="{ left: Math.max(0, hintRange.left) + 12 + 'px' }"
    >
      {{ emptyHint }}
    </span>

    <EditorClip
      v-for="{ clip, next } in visibleClips"
      :key="clip.id"
      :clip="clip"
      :track="track"
      :timeline="timeline"
      :px-per-frame="pxPerFrame"
      :height="height"
      :name-display="nameDisplay"
      :clip-display="clipDisplay"
      :next-position="next"
      :selected="selectedClipIds.includes(clip.id)"
      @select="$emit('select-clip', clip, $event)"
      @edit="$emit('edit-clip', clip)"
      @delete="$emit('delete-clip', clip)"
      @crop="$emit('crop-clip', { clip, fields: $event })"
      @move="$emit('move-clip', { clip, position: $event })"
    />
  </div>
</template>
