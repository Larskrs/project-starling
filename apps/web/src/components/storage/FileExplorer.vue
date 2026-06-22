<script setup>
import { ref } from 'vue'
import { Icon } from '@iconify/vue'
import FileList           from './FileList.vue'
import FileBreadcrumb     from './FileBreadcrumb.vue'
import DropUpload         from './DropUpload.vue'
import SelectFolderDialog from './SelectFolderDialog.vue'
import Button             from '../ui/Button.vue'
import Input              from '../ui/Input.vue'
import Label              from '../ui/Label.vue'
import Dialog             from '../ui/Dialog.vue'
import ConfirmDialog      from '../ui/ConfirmDialog.vue'
import { useUpload }            from '../../composables/useUpload'
import { provideFileSelection } from '../../composables/useFileSelection.js'

const props = defineProps({
  productionId: { type: String, required: true },
})

const emit = defineEmits(['select'])

const ACCEPTED = 'image/jpeg,image/png,image/webp,image/gif,image/avif,audio/mpeg,audio/wav,audio/ogg,audio/flac,audio/aac,audio/x-m4a'

// ── File selection ─────────────────────────────────────────────────────────
const { selectedIds, selectedCount, selectionActive, clearSelection, selectAll } = provideFileSelection()

// ── Nav / UI state ─────────────────────────────────────────────────────────
const fileListRef      = ref(null)
const fileCrumbs       = ref([{ id: null, label: 'Root' }])
const navState         = ref({ canGoBack: false, canGoForward: false })
const fileInputRef     = ref(null)
const currentFolderId  = ref(null)

// ── Upload ─────────────────────────────────────────────────────────────────
const { queue, uploadFiles } = useUpload({
  productionId: () => props.productionId,
  folderId:     currentFolderId,
  onUploaded:   () => fileListRef.value?.refresh(),
  onError:      (msg) => console.warn('[FileExplorer]', msg),
})

function onFileInput(e) {
  uploadFiles([...e.target.files])
  e.target.value = ''
}

function onNavigate(folderId) {
  currentFolderId.value = folderId
  clearSelection()
}

// ── Create folder ──────────────────────────────────────────────────────────
const createFolderOpen = ref(false)
const folderName       = ref('')
const folderError      = ref('')
const folderLoading    = ref(false)

async function submitCreateFolder() {
  folderError.value   = ''
  folderLoading.value = true
  try {
    const res  = await fetch('/api/storage', {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body:        JSON.stringify({
        production_id: props.productionId,
        name:          folderName.value.trim(),
        parent_id:     currentFolderId.value,
      }),
    })
    const data = await res.json()
    if (!res.ok) { folderError.value = data.error ?? 'Failed to create folder'; return }
    createFolderOpen.value = false
    folderName.value       = ''
    fileListRef.value?.refresh()
  } catch {
    folderError.value = 'Network error'
  } finally {
    folderLoading.value = false
  }
}

function openCreateFolder() {
  folderName.value       = ''
  folderError.value      = ''
  createFolderOpen.value = true
}

// ── Bulk delete ────────────────────────────────────────────────────────────
const confirmDeleteOpen = ref(false)
const deleting          = ref(false)

async function deleteSelected() {
  deleting.value = true
  try {
    const ids = [...selectedIds.value]
    await Promise.all(ids.map(id =>
      fetch(`/api/storage/${id}`, { method: 'DELETE', credentials: 'include' })
    ))
    clearSelection()
    fileListRef.value?.refresh()
  } finally {
    deleting.value          = false
    confirmDeleteOpen.value = false
  }
}

// ── Move to folder ─────────────────────────────────────────────────────────
const moveFolderOpen = ref(false)
const moving         = ref(false)

async function moveSelected(folderId) {
  moving.value = true
  try {
    const ids = [...selectedIds.value]
    await Promise.all(ids.map(id =>
      fetch(`/api/storage/${id}`, {
        method:      'PATCH',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ folder_id: folderId }),
      })
    ))
    clearSelection()
    fileListRef.value?.refresh()
  } finally {
    moving.value         = false
    moveFolderOpen.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">

    <!-- Header -->
    <div class="flex flex-col lg:flex-row items-start justify-start lg:justify-between gap-2">
      <div class="flex items-center gap-1.5">
        <button
          class="p-1 rounded-md text-muted-foreground transition-colors hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :disabled="!navState.canGoBack"
          @click="fileListRef?.goBack()"
        >
          <Icon icon="mdi:arrow-left" class="size-4" />
        </button>
        <button
          class="p-1 rounded-md text-muted-foreground transition-colors hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :disabled="!navState.canGoForward"
          @click="fileListRef?.goForward()"
        >
          <Icon icon="mdi:arrow-right" class="size-4" />
        </button>
        <FileBreadcrumb :items="fileCrumbs" @navigate="fileListRef?.goToCrumb($event - 1)" />
      </div>
      <div class="flex items-center gap-2">
        <Button size="sm" variant="outline" @click="openCreateFolder">
          <Icon icon="mdi:folder-plus-outline" class="mr-1.5 text-base" />
          New folder
        </Button>
        <Button size="sm" variant="default" @click="fileInputRef.click()">
          <Icon icon="mdi:upload" class="mr-1.5 text-base" />
          Upload
        </Button>
        <input
          ref="fileInputRef"
          type="file"
          class="sr-only"
          multiple
          :accept="ACCEPTED"
          @change="onFileInput"
        />
      </div>
    </div>

    <!-- Selection action bar -->
    <Transition name="sel-bar">
      <div
        v-if="selectionActive"
        class="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border bg-card text-sm"
      >
        <span class="font-medium text-foreground">{{ selectedCount }} selected</span>
        <button
          class="text-xs text-muted-foreground hover:text-foreground transition-colors"
          @click="selectAll(fileListRef?.getFileIds() ?? [])"
        >Select all</button>
        <div class="flex-1" />
        <Button size="xs" variant="outline" :disabled="moving" @click="moveFolderOpen = true">
          <Icon icon="mdi:folder-move-outline" class="mr-1 text-base" />
          Move
        </Button>
        <Button size="xs" variant="destructive" @click="confirmDeleteOpen = true">
          <Icon icon="mdi:trash-can-outline" class="mr-1 text-base" />
          Delete
        </Button>
        <button
          class="ml-1 p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
          title="Clear selection"
          @click="clearSelection"
        >
          <Icon icon="mdi:close" class="text-base" />
        </button>
      </div>
    </Transition>

    <!-- Upload queue -->
    <TransitionGroup v-if="queue.length" tag="ul" name="queue" class="flex flex-col gap-1">
      <li
        v-for="u in queue"
        :key="u.id"
        class="flex items-center gap-2.5 px-3 py-2 rounded-md border border-border bg-card text-sm"
      >
        <Icon
          :icon="u.status === 'done'  ? 'mdi:check-circle-outline'
               : u.status === 'error' ? 'mdi:alert-circle-outline'
               :                        'mdi:loading'"
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

    <!-- File grid / list — also a drop target -->
    <DropUpload
      :production-id="productionId"
      :folder-id="currentFolderId"
      @uploaded="fileListRef?.refresh()"
      @error="(msg) => console.warn('[FileExplorer drop]', msg)"
    >
      <FileList
        ref="fileListRef"
        :production-id="productionId"
        @navigate="onNavigate"
        @crumbs-change="fileCrumbs = $event"
        @nav-change="navState = $event"
        @select="emit('select', $event)"
      />
    </DropUpload>

    <!-- Create folder dialog -->
    <Dialog :open="createFolderOpen" class="max-w-sm" @close="createFolderOpen = false">
      <div class="p-6 flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <h3 class="text-base font-semibold text-foreground">New folder</h3>
          <button class="text-muted-foreground hover:text-foreground transition-colors" @click="createFolderOpen = false">✕</button>
        </div>
        <form class="flex flex-col gap-3" @submit.prevent="submitCreateFolder">
          <div class="flex flex-col gap-1.5">
            <Label for="folder-name">Folder name</Label>
            <Input id="folder-name" v-model="folderName" placeholder="Assets" autofocus required />
          </div>
          <p v-if="folderError" class="text-sm text-destructive">{{ folderError }}</p>
          <div class="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" @click="createFolderOpen = false">Cancel</Button>
            <Button type="submit" :disabled="!folderName.trim() || folderLoading">
              {{ folderLoading ? 'Creating…' : 'Create folder' }}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>

    <!-- Confirm bulk delete -->
    <ConfirmDialog
      :open="confirmDeleteOpen"
      title="Delete selected files"
      confirm-label="Delete files"
      :loading="deleting"
      destructive
      @confirm="deleteSelected"
      @cancel="confirmDeleteOpen = false"
    >
      Delete {{ selectedCount }} {{ selectedCount === 1 ? 'file' : 'files' }}? This cannot be undone.
    </ConfirmDialog>

    <!-- Move to folder dialog -->
    <SelectFolderDialog
      :open="moveFolderOpen"
      :production-id="productionId"
      title="Move files to folder"
      @select="moveSelected"
      @close="moveFolderOpen = false"
    />

  </div>
</template>

<style scoped>
.queue-enter-active, .queue-leave-active { transition: opacity 0.2s, transform 0.2s; }
.queue-enter-from,   .queue-leave-to     { opacity: 0; transform: translateY(-4px); }

.sel-bar-enter-active, .sel-bar-leave-active { transition: opacity 0.15s, transform 0.15s; }
.sel-bar-enter-from,   .sel-bar-leave-to     { opacity: 0; transform: translateY(-6px); }
</style>
