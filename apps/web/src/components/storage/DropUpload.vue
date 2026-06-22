<script setup>
import { ref } from 'vue'
import { useUpload } from '../../composables/useUpload'

const props = defineProps({
  productionId: { type: String,  required: true },
  folderId:  { type: String,  default: null },
  multiple:  { type: Boolean, default: true },
})

const emit = defineEmits(['uploaded', 'error'])

const { queue, uploadFiles } = useUpload({
  productionId:  () => props.productionId,
  folderId:   () => props.folderId,
  onUploaded: (file, versions) => emit('uploaded', file, versions),
  onError:    (msg) => emit('error', msg),
})

const dragging = ref(false)
let dragCounter = 0

function onDragenter(e) {
  e.preventDefault()
  if (++dragCounter === 1) dragging.value = true
}

function onDragleave() {
  if (--dragCounter <= 0) { dragCounter = 0; dragging.value = false }
}

function onDragover(e) { e.preventDefault() }

function onDrop(e) {
  e.preventDefault()
  dragCounter = 0
  dragging.value = false
  const files = [...e.dataTransfer.files]
  if (files.length) uploadFiles(files)
}
</script>

<template>
  <div
    class="relative"
    @dragenter="onDragenter"
    @dragleave="onDragleave"
    @dragover="onDragover"
    @drop="onDrop"
  >
    <slot :dragging="dragging" :queue="queue" :upload="uploadFiles" />

    <Transition name="drop-overlay">
      <div
        v-if="dragging"
        class="pointer-events-none absolute inset-0 z-10 rounded-lg border-2 border-dashed border-primary bg-primary/5 flex items-center justify-center"
      >
        <span class="text-sm font-medium text-primary select-none">Drop to upload</span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.drop-overlay-enter-active, .drop-overlay-leave-active { transition: opacity 0.15s; }
.drop-overlay-enter-from,   .drop-overlay-leave-to     { opacity: 0; }
</style>
