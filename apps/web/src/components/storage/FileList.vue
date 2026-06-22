<script setup>
import { ref, computed, watch, onMounted, provide } from 'vue'
import { Icon } from '@iconify/vue'
import Folder      from './Folder.vue'
import FileImage   from './FileImage.vue'
import FileAudio   from './FileAudio.vue'
import FileDefault from './FileDefault.vue'

const props = defineProps({
  productionId: { type: String, required: true },
  rootFolderId: { type: String, default: null },
})

const emit = defineEmits(['navigate', 'select', 'deleted', 'crumbs-change', 'nav-change'])

provide('storage-production-id', props.productionId)

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
    const params = new URLSearchParams({ pid: props.productionId })
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

// ── Navigation history ────────────────────────────────────────────────────────

// cursor-in-array history: entries to the right of the index are "future"
const navHistory = ref([{ folderId: props.rootFolderId ?? null, crumbs: [] }])
const navIndex   = ref(0)

const canGoBack    = computed(() => navIndex.value > 0)
const canGoForward = computed(() => navIndex.value < navHistory.value.length - 1)

function applyEntry(entry) {
  crumbs.value          = entry.crumbs
  currentFolderId.value = entry.folderId
  load(entry.folderId)
  emit('navigate', entry.folderId)
}

// Push a new entry and clear any forward history — call on explicit user navigation
function pushEntry(folderId, newCrumbs) {
  navHistory.value = navHistory.value.slice(0, navIndex.value + 1)
  navHistory.value.push({ folderId, crumbs: newCrumbs })
  navIndex.value++
}

function goBack() {
  if (!canGoBack.value) return
  navIndex.value--
  applyEntry(navHistory.value[navIndex.value])
}

function goForward() {
  if (!canGoForward.value) return
  navIndex.value++
  applyEntry(navHistory.value[navIndex.value])
}

function enterFolder(folder) {
  const newCrumbs = [...crumbs.value, { id: folder.id, name: folder.name }]
  crumbs.value          = newCrumbs
  currentFolderId.value = folder.id
  load(folder.id)
  emit('navigate', folder.id)
  pushEntry(folder.id, newCrumbs)
}

function goToCrumb(idx) {
  const newCrumbs = idx === -1 ? [] : crumbs.value.slice(0, idx + 1)
  const folderId  = idx === -1 ? null : newCrumbs[idx].id
  crumbs.value          = newCrumbs
  currentFolderId.value = folderId
  load(folderId)
  emit('navigate', folderId)
  pushEntry(folderId, newCrumbs)
}

// ── File actions ──────────────────────────────────────────────────────────────

// FileBase handles the DELETE API call; we just update the local list
function deleteFile(file) {
  files.value = files.value.filter(f => f.id !== file.id)
  emit('deleted', file.id)
}

function onFileRenamed({ id, name }) {
  const idx = files.value.findIndex(f => f.id === id)
  if (idx !== -1) files.value[idx] = { ...files.value[idx], name }
}

function onFileMoved(fileId) {
  files.value = files.value.filter(f => f.id !== fileId)
}

function onFolderRenamed({ id, name }) {
  const idx = folders.value.findIndex(f => f.id === id)
  if (idx !== -1) folders.value[idx] = { ...folders.value[idx], name }
}

async function setFolderHue({ folder, hue }) {
  const res = await fetch(`/api/storage/folders/${folder.id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hue }),
  })
  if (!res.ok) return
  const idx = folders.value.findIndex(f => f.id === folder.id)
  if (idx !== -1) folders.value[idx] = { ...folders.value[idx], hue }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(() => load(currentFolderId.value))

watch(() => props.rootFolderId, (id) => {
  crumbs.value          = []
  currentFolderId.value = id
  navHistory.value      = [{ folderId: id ?? null, crumbs: [] }]
  navIndex.value        = 0
  load(id)
})

const breadcrumbItems = computed(() => [
  { id: null, label: 'Root' },
  ...crumbs.value.map(c => ({ id: c.id, label: c.name })),
])

watch(breadcrumbItems, (items) => emit('crumbs-change', items), { immediate: true })
watch([canGoBack, canGoForward], ([back, forward]) => emit('nav-change', { canGoBack: back, canGoForward: forward }), { immediate: true })

defineExpose({ refresh: () => load(currentFolderId.value), goToCrumb, goBack, goForward, getFileIds: () => files.value.map(f => f.id) })
</script>

<template>
  <div class="flex flex-col gap-4">

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
        <div class="grid gap-2" style="grid-template-columns: repeat(auto-fill, minmax(230px, 1fr))">
          <Folder
            v-for="folder in folders"
            :key="folder.id"
            :folder="folder"
            @open="enterFolder"
            @hue-change="setFolderHue"
            @renamed="onFolderRenamed"
            @deleted="folders = folders.filter(f => f.id !== $event)"
          />
        </div>
      </div>

      <!-- Files section -->
      <div v-if="files.length > 0" class="flex flex-col gap-2">
        <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Files</p>
        <div class="grid gap-2" style="grid-template-columns: repeat(auto-fill, minmax(230px, 1fr))">
          <template v-for="file in files" :key="file.id">
            <FileImage
              v-if="file.type === 'image'"
              :file="file"
              @select="emit('select', file)"
              @delete="deleteFile"
              @renamed="onFileRenamed"
              @moved="onFileMoved"
            />
            <FileAudio
              v-else-if="file.type === 'audio'"
              :file="file"
              @select="emit('select', file)"
              @delete="deleteFile"
              @renamed="onFileRenamed"
              @moved="onFileMoved"
            />
            <FileDefault
              v-else
              :file="file"
              @select="emit('select', file)"
              @delete="deleteFile"
              @renamed="onFileRenamed"
              @moved="onFileMoved"
            />
          </template>
        </div>
      </div>

    </template>

  </div>
</template>
