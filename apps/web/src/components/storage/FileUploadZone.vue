<script setup>
import { ref } from 'vue'
import { Icon } from '@iconify/vue'

const props = defineProps({
  companyId: { type: String,  required: true },
  folderId:  { type: String,  default: null },
  multiple:  { type: Boolean, default: true },
})

const emit = defineEmits(['uploaded', 'error'])

const ACCEPTED = 'image/jpeg,image/png,image/webp,image/gif,image/avif,audio/mpeg,audio/wav,audio/ogg,audio/flac,audio/aac,audio/x-m4a'

const dragging = ref(false)
const queue    = ref([]) // { id, name, status: 'uploading'|'done'|'error' }
const inputRef = ref(null)
let   nextId   = 0

function onDragover(e)  { e.preventDefault(); dragging.value = true }
function onDragleave()  { dragging.value = false }
function onDrop(e)      { e.preventDefault(); dragging.value = false; uploadFiles([...e.dataTransfer.files]) }
function onFileInput(e) { uploadFiles([...e.target.files]); e.target.value = '' }

async function uploadFiles(files) {
  await Promise.all(files.map(uploadOne))
}

async function uploadOne(file) {
  const entry = { id: nextId++, name: file.name, status: 'uploading' }
  queue.value = [...queue.value, entry]

  const body = new FormData()
  body.append('company_id', props.companyId)
  if (props.folderId) body.append('folder_id', props.folderId)
  body.append('file', file)

  try {
    const res  = await fetch('/api/storage/upload', { method: 'POST', credentials: 'include', body })
    const data = await res.json()

    if (!res.ok) {
      entry.status = 'error'
      emit('error', data.error ?? `Failed to upload ${file.name}`)
    } else {
      entry.status = 'done'
      emit('uploaded', data.file, data.versions ?? [])
    }
  } catch {
    entry.status = 'error'
    emit('error', `Network error uploading ${file.name}`)
  } finally {
    queue.value = [...queue.value]
    setTimeout(() => { queue.value = queue.value.filter(u => u.id !== entry.id) }, 3000)
  }
}
</script>

<template>
  <div class="flex flex-col gap-2">

    <!-- Drop zone -->
    <div
      role="button"
      tabindex="0"
      class="relative border-2 border-dashed rounded-lg p-8 text-center transition-colors select-none"
      :class="dragging
        ? 'border-primary bg-primary/5'
        : 'border-border hover:border-muted-foreground/40 cursor-pointer'"
      @dragover="onDragover"
      @dragleave="onDragleave"
      @drop="onDrop"
      @click="inputRef.click()"
      @keydown.enter.space.prevent="inputRef.click()"
    >
      <Icon icon="mdi:cloud-upload-outline" class="text-4xl text-muted-foreground mx-auto mb-2.5" />
      <p class="text-sm font-medium text-foreground">Drop files here or click to browse</p>
      <p class="text-xs text-muted-foreground mt-1">Images · JPEG, PNG, WebP, GIF, AVIF</p>
      <p class="text-xs text-muted-foreground">Audio · MP3, WAV, OGG, FLAC, AAC</p>

      <input
        ref="inputRef"
        type="file"
        class="sr-only"
        :multiple="multiple"
        :accept="ACCEPTED"
        @change="onFileInput"
      />
    </div>

    <!-- Upload queue -->
    <TransitionGroup tag="ul" name="queue" class="flex flex-col gap-1">
      <li
        v-for="u in queue"
        :key="u.id"
        class="flex items-center gap-2.5 px-3 py-2 rounded-md border border-border bg-card text-sm"
      >
        <Icon
          :icon="u.status === 'done'      ? 'mdi:check-circle-outline'
               : u.status === 'error'     ? 'mdi:alert-circle-outline'
               :                            'mdi:loading'"
          :class="[
            'text-base shrink-0',
            u.status === 'done'  ? 'text-green-500' :
            u.status === 'error' ? 'text-destructive' :
                                   'text-muted-foreground animate-spin',
          ]"
        />
        <span class="flex-1 truncate text-foreground">{{ u.name }}</span>
        <span class="text-xs text-muted-foreground capitalize shrink-0">{{ u.status }}</span>
      </li>
    </TransitionGroup>

  </div>
</template>

<style scoped>
.queue-enter-active, .queue-leave-active { transition: opacity 0.2s, transform 0.2s; }
.queue-enter-from, .queue-leave-to       { opacity: 0; transform: translateY(-4px); }
</style>
