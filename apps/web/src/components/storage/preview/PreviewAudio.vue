<script setup>
import { computed } from 'vue'
import PreviewBase    from './PreviewBase.vue'
import WaveformPlayer from '../../audio/WaveformPlayer.vue'

const props = defineProps({
  file:    { type: Object,  required: true },
  hasPrev: { type: Boolean, default: false },
  hasNext: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'prev', 'next'])

const src = computed(() => `/api/storage/${props.file.id}/serve`)
</script>

<template>
  <PreviewBase :file="file" :has-prev="hasPrev" :has-next="hasNext"
    @close="emit('close')" @prev="emit('prev')" @next="emit('next')"
  >
    <div class="w-full h-full flex items-center justify-center rounded-lg bg-muted/20 p-6">
      <WaveformPlayer :key="file.id" :src="src" class="w-full max-w-lg" />
    </div>
  </PreviewBase>
</template>
