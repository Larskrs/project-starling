<script setup>
import { ref, watch, onMounted } from 'vue'
import { Icon } from '@iconify/vue'
import Folder      from './Folder.vue'
import FileImage   from './FileImage.vue'
import FileAudio   from './FileAudio.vue'
import FileDefault from './FileDefault.vue'

const props = defineProps({
  companyId:    { type: String, required: true },
  rootFolderId: { type: String, default: null },
})

const emit = defineEmits(['navigate', 'select', 'deleted'])

// ── State ─────────────────────────────────────────────────────────────────────

const folders         = ref([])
const files           = ref([])
const loading         = ref(true)
const error           = ref('')
const crumbs          = ref([])  // [{ id, name }]
const currentFolderId = ref(props.rootFolderId)

// ── Data ──────────────────────────────────────────────────────────────────────

async function load(folderId) {
  loading.value = true
  error.value   = ''
  try {
    const params = new URLSearchParams({ cid: props.companyId })
    if (folderId) params.set('folder_id', folderId)

    const res = await fetch(`/api/storage?${params}`, { credentials: 'include' })
    if (!res.ok) throw new Error()

    const data    = await res.json()
    folders.value = data.folders
    files.value   = data.files
  } catch {
    error.value = 'Could not load files'
  } finally {
    loading.value = false
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────

function enterFolder(folder) {
  crumbs.value          = [...crumbs.value, { id: folder.id, name: folder.name }]
  currentFolderId.value = folder.id
  load(folder.id)
  emit('navigate', folder.id)
}

function goToCrumb(idx) {
  if (idx === -1) {
    crumbs.value          = []
    currentFolderId.value = null
  } else {
    crumbs.value          = crumbs.value.slice(0, idx + 1)
    currentFolderId.value = crumbs.value[idx].id
  }
  load(currentFolderId.value)
  emit('navigate', currentFolderId.value)
}

// ── File actions ──────────────────────────────────────────────────────────────

async function deleteFile(file) {
  const res = await fetch(`/api/storage/${file.id}`, { method: 'DELETE', credentials: 'include' })
  if (!res.ok) return
  files.value = files.value.filter(f => f.id !== file.id)
  emit('deleted', file.id)
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(() => load(currentFolderId.value))

watch(() => props.rootFolderId, (id) => {
  crumbs.value          = []
  currentFolderId.value = id
  load(id)
})

defineExpose({ refresh: () => load(currentFolderId.value) })
</script>

<template>
  <div class="flex flex-col gap-4">

    <!-- Breadcrumb -->
    <nav class="flex items-center gap-1 text-sm flex-wrap">
      <button
        class="transition-colors"
        :class="crumbs.length === 0
          ? 'text-foreground font-medium pointer-events-none'
          : 'text-muted-foreground hover:text-foreground'"
        @click="goToCrumb(-1)"
      >
        Root
      </button>
      <template v-for="(crumb, i) in crumbs" :key="crumb.id">
        <Icon icon="mdi:chevron-right" class="text-muted-foreground/40 text-xs shrink-0" />
        <button
          class="transition-colors truncate max-w-36"
          :class="i === crumbs.length - 1
            ? 'text-foreground font-medium pointer-events-none'
            : 'text-muted-foreground hover:text-foreground'"
          @click="goToCrumb(i)"
        >
          {{ crumb.name }}
        </button>
      </template>
    </nav>

    <!-- Loading -->
    <div v-if="loading" class="py-8 text-center">
      <Icon icon="mdi:loading" class="animate-spin text-2xl text-muted-foreground/50" />
    </div>

    <!-- Error -->
    <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>

    <!-- Empty -->
    <div
      v-else-if="folders.length === 0 && files.length === 0"
      class="rounded-lg border border-dashed border-border py-12 text-center"
    >
      <Icon icon="mdi:folder-open-outline" class="text-4xl text-muted-foreground/30 mx-auto mb-2" />
      <p class="text-sm text-muted-foreground">This folder is empty.</p>
    </div>

    <template v-else>

      <!-- Folders section -->
      <div v-if="folders.length > 0" class="flex flex-col gap-2">
        <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Folders</p>
        <div class="grid gap-2" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))">
          <Folder
            v-for="folder in folders"
            :key="folder.id"
            :folder="folder"
            @open="enterFolder"
          />
        </div>
      </div>

      <!-- Files section -->
      <div v-if="files.length > 0" class="flex flex-col gap-2">
        <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Files</p>
        <div class="grid gap-2" style="grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))">
          <template v-for="file in files" :key="file.id">
            <FileImage
              v-if="file.type === 'image'"
              :file="file"
              @select="emit('select', file)"
              @delete="deleteFile"
            />
            <FileAudio
              v-else-if="file.type === 'audio'"
              :file="file"
              @select="emit('select', file)"
              @delete="deleteFile"
            />
            <FileDefault
              v-else
              :file="file"
              @select="emit('select', file)"
              @delete="deleteFile"
            />
          </template>
        </div>
      </div>

    </template>

  </div>
</template>
