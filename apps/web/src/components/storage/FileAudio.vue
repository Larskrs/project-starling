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
      <div class="w-full h-full bg-gradient-to-br from-blue-500/10 via-indigo-500/10 to-purple-500/10 flex flex-col items-center justify-center gap-3">
        <Icon icon="mdi:waveform" class="text-5xl text-blue-400/60 group-hover:text-blue-400/80 transition-colors" />
        <Icon icon="mdi:play-circle-outline" class="text-2xl text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
      </div>
    </template>

    <template #info>
      <p class="text-xs font-medium text-foreground truncate leading-snug">{{ file.name }}</p>
      <p class="text-xs text-muted-foreground leading-snug">{{ formatSize(file.size) }}</p>
    </template>

  </FileBase>
</template>
