<script setup>
import { Icon } from '@iconify/vue'
import FileBase from './FileBase.vue'

defineProps({ file: { type: Object, required: true } })
defineEmits(['select', 'delete'])

function formatSize(bytes) {
  if (bytes < 1024)      return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}
</script>

<template>
  <FileBase :file="file" @select="$emit('select', file)" @delete="$emit('delete', file)">

    <template #preview>
      <div class="w-full h-full bg-muted/40 flex items-center justify-center">
        <Icon icon="mdi:file-outline" class="text-5xl text-muted-foreground/40 group-hover:text-muted-foreground/60 transition-colors" />
      </div>
    </template>

    <template #info>
      <p class="text-xs font-medium text-foreground truncate leading-snug">{{ file.name }}</p>
      <p class="text-xs text-muted-foreground font-mono truncate leading-snug">{{ formatSize(file.size) }}</p>
    </template>

  </FileBase>
</template>
