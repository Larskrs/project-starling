<script setup>
import { computed } from 'vue'
import PreviewImage   from './PreviewImage.vue'
import PreviewAudio   from './PreviewAudio.vue'
import PreviewDefault from './PreviewDefault.vue'

const props = defineProps({
  file:    { type: Object,  required: true },
  hasPrev: { type: Boolean, default: false },
  hasNext: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'prev', 'next'])

const component = computed(() => {
  if (props.file.type === 'image') return PreviewImage
  if (props.file.type === 'audio') return PreviewAudio
  return PreviewDefault
})
</script>

<template>
  <component
    :is="component"
    :file="file"
    :has-prev="hasPrev"
    :has-next="hasNext"
    @close="emit('close')"
    @prev="emit('prev')"
    @next="emit('next')"
  />
</template>
