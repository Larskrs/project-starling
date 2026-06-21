<script setup>
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import FileBase from './FileBase.vue'

const props = defineProps({ file: { type: Object, required: true } })
defineEmits(['select', 'delete', 'renamed', 'moved'])

const thumbnailSrc = computed(() => {
  if (!props.file.versions?.length) return null
  const best = [...props.file.versions].sort((a, b) => a.quality - b.quality)[0]
  return `/api/storage/${props.file.id}/serve?quality=${best.quality}`
})

function formatSize(bytes) {
  if (bytes < 1024)      return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}
</script>

<template>
  <FileBase :file="file" @select="$emit('select', file)" @delete="$emit('delete', file)" @renamed="$emit('renamed', $event)" @moved="$emit('moved', $event)">

    <template #preview>
      <img
        v-if="thumbnailSrc"
        :src="thumbnailSrc"
        :alt="file.name"
        class="w-full h-full object-cover transition-transform duration-300"
        loading="lazy"
      />
      <div v-else class="w-full h-full bg-muted flex items-center justify-center">
        <Icon icon="mdi:image-outline" class="text-4xl text-muted-foreground/40" />
      </div>
    </template>

    <template #info>
      <p class="text-sm font-medium text-foreground truncate leading-snug">{{ file.name }}</p>
      <p class="text-xs mt-1 text-muted-foreground leading-snug">
        {{ formatSize(file.size) }}
        <span v-if="file.versions?.length > 1"> · {{ file.versions.length }}v</span>
      </p>
    </template>

  </FileBase>
</template>
