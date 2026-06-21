<script setup>
import { ref } from 'vue'
import { Icon } from '@iconify/vue'
import FileList        from './FileList.vue'
import FileBreadcrumb  from './FileBreadcrumb.vue'
import DropUpload      from './DropUpload.vue'
import Button          from '../ui/Button.vue'
import Input           from '../ui/Input.vue'
import Label           from '../ui/Label.vue'
import Dialog          from '../ui/Dialog.vue'
import { useUpload } from '../../composables/useUpload'

const props = defineProps({
  companyId: { type: String, required: true },
})

const emit = defineEmits(['select'])

const ACCEPTED = 'image/jpeg,image/png,image/webp,image/gif,image/avif,audio/mpeg,audio/wav,audio/ogg,audio/flac,audio/aac,audio/x-m4a'

const fileListRef      = ref(null)
const fileCrumbs       = ref([{ id: null, label: 'Root' }])
const navState         = ref({ canGoBack: false, canGoForward: false })
const fileInputRef     = ref(null)
const createFolderOpen = ref(false)
const folderName       = ref('')
const folderError      = ref('')
const folderLoading    = ref(false)
const currentFolderId  = ref(null)

const { queue, uploadFiles } = useUpload({
  companyId:  () => props.companyId,
  folderId:   currentFolderId,
  onUploaded: () => fileListRef.value?.refresh(),
  onError:    (msg) => console.warn('[FileExplorer]', msg),
})

function onFileInput(e) {
  uploadFiles([...e.target.files])
  e.target.value = ''
}

function onNavigate(folderId) {
  currentFolderId.value = folderId
}

async function submitCreateFolder() {
  folderError.value   = ''
  folderLoading.value = true
  try {
    const res  = await fetch('/api/storage', {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body:        JSON.stringify({
        company_id: props.companyId,
        name:       folderName.value.trim(),
        parent_id:  currentFolderId.value,
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
  folderName.value  = ''
  folderError.value = ''
  createFolderOpen.value = true
}
</script>

<template>
  <div class="flex flex-col gap-4">

    <!-- Header -->
    <div class="flex flex-col lg:flex-row items-start justify-start lg:justify-between">
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
      :company-id="companyId"
      :folder-id="currentFolderId"
      @uploaded="fileListRef?.refresh()"
      @error="(msg) => console.warn('[FileExplorer drop]', msg)"
    >
      <FileList
        ref="fileListRef"
        :company-id="companyId"
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

  </div>
</template>

<style scoped>
.queue-enter-active, .queue-leave-active { transition: opacity 0.2s, transform 0.2s; }
.queue-enter-from,   .queue-leave-to     { opacity: 0; transform: translateY(-4px); }
</style>
