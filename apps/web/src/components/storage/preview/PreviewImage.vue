<script setup>
import { computed } from 'vue'
import PreviewBase from './PreviewBase.vue'

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
    <div class="w-full h-full flex items-center justify-center rounded-lg overflow-hidden bg-muted/20">
      <img
        :key="file.id"
        :src="src"
        :alt="file.name"
        class="max-w-full max-h-full object-contain rounded"
        draggable="false"
      />
    </div>
  </PreviewBase>
</template>
