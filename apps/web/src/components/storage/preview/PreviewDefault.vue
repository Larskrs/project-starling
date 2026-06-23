<script setup>
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import PreviewBase from './PreviewBase.vue'

const props = defineProps({
  file:    { type: Object,  required: true },
  hasPrev: { type: Boolean, default: false },
  hasNext: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'prev', 'next'])

const downloadHref = computed(() => `/api/storage/${props.file.id}/serve`)
</script>

<template>
  <PreviewBase :file="file" :has-prev="hasPrev" :has-next="hasNext"
    @close="emit('close')" @prev="emit('prev')" @next="emit('next')"
  >
    <div class="w-full h-full flex flex-col items-center justify-center gap-4 rounded-lg bg-muted/20 p-6">
      <Icon icon="mdi:file-outline" class="text-7xl text-muted-foreground/30" />
      <p class="text-sm text-muted-foreground">No preview available</p>
      <a
        :href="downloadHref"
        download
        class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <Icon icon="mdi:download" class="text-base" />
        Download
      </a>
    </div>
  </PreviewBase>
</template>
