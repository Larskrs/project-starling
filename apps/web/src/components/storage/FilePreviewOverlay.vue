<script setup>
import { computed, onMounted, onBeforeUnmount } from 'vue'
import FilePreviewDisplay from './preview/FilePreviewDisplay.vue'

const props = defineProps({
  file:  { type: Object, required: true },
  files: { type: Array,  required: true },
})

const emit = defineEmits(['close', 'navigate'])

const idx     = computed(() => props.files.findIndex(f => f.id === props.file.id))
const hasPrev = computed(() => idx.value > 0)
const hasNext = computed(() => idx.value < props.files.length - 1)

function prev() { if (hasPrev.value) emit('navigate', props.files[idx.value - 1]) }
function next() { if (hasNext.value) emit('navigate', props.files[idx.value + 1]) }

function onKeydown(e) {
  if (e.key === 'Escape')     { e.preventDefault(); emit('close') }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); prev() }
  if (e.key === 'ArrowRight') { e.preventDefault(); next() }
}

onMounted(()      => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="fixed inset-0 z-20 p-6 flex flex-col">
    <div class="fixed inset-0 bg-background/85 backdrop-blur-sm" @click="emit('close')" />
    <div class="relative z-10 flex-1 min-h-0">
      <FilePreviewDisplay
        :file="file"
        :has-prev="hasPrev"
        :has-next="hasNext"
        @close="emit('close')"
        @prev="prev"
        @next="next"
      />
    </div>
  </div>
</template>
