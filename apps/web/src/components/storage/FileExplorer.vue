<script setup>
import { ref } from 'vue'
import { Icon } from '@iconify/vue'
import FileUploadZone from './FileUploadZone.vue'
import FileList       from './FileList.vue'
import Button         from '../ui/Button.vue'
import Input          from '../ui/Input.vue'
import Label          from '../ui/Label.vue'
import Dialog         from '../ui/Dialog.vue'

const props = defineProps({
  companyId: { type: String, required: true },
})

const emit = defineEmits(['select'])

const fileListRef       = ref(null)
const showUpload        = ref(false)
const createFolderOpen  = ref(false)
const folderName        = ref('')
const folderError       = ref('')
const folderLoading     = ref(false)
const currentFolderId   = ref(null)

function onUploaded() {
  fileListRef.value?.refresh()
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
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold text-foreground">Files</h2>
      <div class="flex items-center gap-2">
        <Button size="sm" variant="outline" @click="openCreateFolder">
          <Icon icon="mdi:folder-plus-outline" class="mr-1.5 text-base" />
          New folder
        </Button>
        <Button size="sm" :variant="showUpload ? 'outline' : 'default'" @click="showUpload = !showUpload">
          <Icon icon="mdi:upload" class="mr-1.5 text-base" />
          Upload
        </Button>
      </div>
    </div>

    <!-- Upload zone (slide in/out) -->
    <Transition name="zone">
      <FileUploadZone
        v-if="showUpload"
        :company-id="companyId"
        :folder-id="currentFolderId"
        @uploaded="onUploaded"
        @error="(msg) => console.warn('[FileExplorer]', msg)"
      />
    </Transition>

    <!-- File grid / list -->
    <FileList
      ref="fileListRef"
      :company-id="companyId"
      @navigate="onNavigate"
      @select="emit('select', $event)"
    />

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
.zone-enter-active, .zone-leave-active { transition: opacity 0.2s, transform 0.15s; }
.zone-enter-from, .zone-leave-to       { opacity: 0; transform: translateY(-6px); }
</style>
