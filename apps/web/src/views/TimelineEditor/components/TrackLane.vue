<script setup>
import EditorClip from './EditorClip.vue'

const props = defineProps({
  track:      { type: Object,  required: true },
  timeline:   { type: Object,  required: true },
  pxPerFrame: { type: Number,  required: true },
  height:     { type: Number,  default: 48 },
  selected:   { type: Boolean, default: false },
})

const emit = defineEmits(['select', 'edit-clip', 'delete-clip', 'crop-clip', 'move-clip'])
</script>

<template>
  <div
    class="relative border-b border-border"
    :class="props.track.isMuted ? 'opacity-50' : ''"
    :style="{ height: height + 'px' }"
  >
    <div
      class="absolute inset-0 transition-colors"
      :class="selected ? 'bg-primary/10' : 'bg-muted/10'"
      @click="$emit('select')"
    />

    <EditorClip
      v-for="(clip, i) in track.clips"
      :key="clip.id"
      :clip="clip"
      :track="track"
      :timeline="timeline"
      :px-per-frame="pxPerFrame"
      :height="height"
      :next-position="track.clips[i + 1]?.position ?? timeline.endFrame"
      @edit="$emit('edit-clip', clip)"
      @delete="$emit('delete-clip', clip)"
      @crop="$emit('crop-clip', { clip, fields: $event })"
      @move="$emit('move-clip', { clip, position: $event })"
    />
  </div>
</template>
