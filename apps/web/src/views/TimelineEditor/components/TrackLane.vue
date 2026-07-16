<script setup>
import { computed, inject, ref } from 'vue'
import { clipWidth } from '../useEditorUtils.js'
import EditorClip from './EditorClip.vue'

const props = defineProps({
  track:       { type: Object,  required: true },
  timeline:    { type: Object,  required: true },
  pxPerFrame:  { type: Number,  required: true },
  height:      { type: Number,  default: 48 },
  selected:    { type: Boolean, default: false },
  muted:       { type: Boolean, default: false },
  nameDisplay: { type: String,  default: 'normal' },
  clipDisplay: { type: String,  default: 'normal' },
})

const emit = defineEmits(['select', 'edit-clip', 'delete-clip', 'crop-clip', 'move-clip'])

const viewport = inject('editor-viewport', ref({ scrollLeft: 0, width: 0 }))

// Only clips whose effective span intersects the viewport (+margin) mount —
// a long timeline can hold hundreds of clips but only the on-screen ones cost
// DOM. Width mirrors EditorClip's geometry: event clips run until the next
// clip, source-backed clip-mode clips are point markers, the rest use clipWidth.
const CULL_MARGIN_PX = 300

const visibleClips = computed(() => {
  const px      = props.pxPerFrame
  const start   = props.timeline.startFrame
  const isEvent = props.track.mode === 'event'
  const clips   = props.track.clips
  const viewL   = viewport.value.scrollLeft - CULL_MARGIN_PX
  const viewR   = viewport.value.scrollLeft + (viewport.value.width || 1600) + CULL_MARGIN_PX

  const out = []
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]
    const next = clips[i + 1]?.position ?? props.timeline.endFrame
    const left = (clip.position - start) * px
    const width = isEvent
      ? Math.max(px, (next - clip.position) * px)
      : (clip.sourceId != null ? Math.max(2, px) : clipWidth(clip, px))
    if (left + width < viewL || left > viewR) continue
    out.push({ clip, next })
  }
  return out
})
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
    />

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
      @edit="$emit('edit-clip', clip)"
      @delete="$emit('delete-clip', clip)"
      @crop="$emit('crop-clip', { clip, fields: $event })"
      @move="$emit('move-clip', { clip, position: $event })"
    />
  </div>
</template>
