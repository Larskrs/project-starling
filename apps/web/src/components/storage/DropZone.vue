<script setup>
import { ref } from 'vue'

/**
 * Drop target. It only reports the files — whoever owns the upload queue
 * decides what happens to them, so dropped files and picked files land in the
 * same queue.
 */
const emit = defineEmits(['drop'])

const dragging = ref(false)
let depth = 0

function onDragenter(e) {
  e.preventDefault()
  if (++depth === 1) dragging.value = true
}

function onDragleave() {
  if (--depth <= 0) { depth = 0; dragging.value = false }
}

function onDrop(e) {
  e.preventDefault()
  depth = 0
  dragging.value = false
  const files = [...e.dataTransfer.files]
  if (files.length) emit('drop', files)
}
</script>

<template>
  <div
    class="relative"
    @dragenter="onDragenter"
    @dragleave="onDragleave"
    @dragover.prevent
    @drop="onDrop"
  >
    <slot :dragging="dragging" />

    <Transition name="drop-overlay">
      <div
        v-if="dragging"
        class="pointer-events-none absolute inset-0 z-10 rounded-lg border-2 border-dashed border-primary bg-primary/5 flex items-center justify-center"
      >
        <span class="text-sm font-medium text-primary select-none">{{ $t('storage.dropToUpload') }}</span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.drop-overlay-enter-active, .drop-overlay-leave-active { transition: opacity 0.15s; }
.drop-overlay-enter-from,   .drop-overlay-leave-to     { opacity: 0; }
</style>
