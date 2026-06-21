<script setup>
import { ref, computed, inject } from 'vue'
import { Icon } from '@iconify/vue'
import { useContextMenu }   from '../../composables/useContextMenu.js'
import { useFileSelection } from '../../composables/useFileSelection.js'
import ContextMenuRoot      from '../ui/ContextMenuRoot.vue'
import ContextMenuItem      from '../ui/ContextMenuItem.vue'
import ContextMenuSeparator from '../ui/ContextMenuSeparator.vue'
import ContextMenuLabel     from '../ui/ContextMenuLabel.vue'
import ConfirmDialog        from '../ui/ConfirmDialog.vue'
import SelectFolderDialog   from './SelectFolderDialog.vue'
import Dialog               from '../ui/Dialog.vue'
import Button               from '../ui/Button.vue'
import Input                from '../ui/Input.vue'
import Label                from '../ui/Label.vue'

const props = defineProps({ file: { type: Object, required: true } })
const emit  = defineEmits(['select', 'delete', 'renamed', 'moved'])

const companyId = inject('storage-company-id', null)
const menu      = useContextMenu()

// ── Selection ─────────────────────────────────────────────────────────────────
const selection       = useFileSelection()
const selected        = computed(() => selection?.isSelected(props.file.id) ?? false)
const selectionActive = computed(() => selection?.selectionActive.value ?? false)

function handlePreviewClick() {
  if (selectionActive.value) {
    selection.toggle(props.file.id)
  } else {
    emit('select', props.file)
  }
}

// ── Open ──────────────────────────────────────────────────────────────────────
function openFile() {
  window.open(`/api/storage/${props.file.id}/serve`, '_blank')
}

// ── Rename ────────────────────────────────────────────────────────────────────
const renameOpen    = ref(false)
const renameName    = ref('')
const renameLoading = ref(false)
const renameError   = ref('')

function startRename() {
  renameName.value  = props.file.name
  renameError.value = ''
  renameOpen.value  = true
}

async function submitRename() {
  const name = renameName.value.trim()
  if (!name || name === props.file.name) { renameOpen.value = false; return }
  renameLoading.value = true
  renameError.value   = ''
  try {
    const res  = await fetch(`/api/storage/${props.file.id}`, {
      method:      'PATCH',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ name }),
    })
    const data = await res.json()
    if (!res.ok) { renameError.value = data.message ?? 'Rename failed'; return }
    renameOpen.value = false
    emit('renamed', { id: props.file.id, name })
  } catch {
    renameError.value = 'Network error'
  } finally {
    renameLoading.value = false
  }
}

// ── Move ──────────────────────────────────────────────────────────────────────
const moveOpen    = ref(false)
const moveLoading = ref(false)

async function doMove(folderId) {
  moveLoading.value = true
  try {
    const res = await fetch(`/api/storage/${props.file.id}`, {
      method:      'PATCH',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ folder_id: folderId }),
    })
    if (!res.ok) return
    moveOpen.value = false
    emit('moved', props.file.id)
  } finally {
    moveLoading.value = false
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────
const confirmDelete = ref(false)
const deleting      = ref(false)

async function doDelete() {
  deleting.value = true
  try {
    const res = await fetch(`/api/storage/${props.file.id}`, { method: 'DELETE', credentials: 'include' })
    if (!res.ok) return
    confirmDelete.value = false
    emit('delete', props.file)
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div
    class="group relative rounded-lg overflow-hidden transition-all"
    :class="selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''"
    @contextmenu.prevent="menu.open($event)"
  >

    <!-- Selection checkbox (top-left, fades in on hover) -->
    <button
      class="absolute top-1.5 left-1.5 z-10 p-0.5 transition-opacity"
      :class="selectionActive || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
      @click.stop="selection?.toggle(file.id)"
    >
      <span
        class="flex items-center justify-center size-5 rounded border-2 transition-colors"
        :class="selected
          ? 'bg-primary border-primary text-primary-foreground'
          : 'bg-background/80 border-muted-foreground/60 hover:border-primary'"
      >
        <Icon v-if="selected" icon="mdi:check" class="text-[10px]" />
      </span>
    </button>

    <!-- Context menu trigger (top-right, fades in on hover) -->
    <button
      class="absolute top-1.5 right-1.5 z-10 p-1 rounded transition-opacity opacity-0 group-hover:opacity-100 bg-background/70 hover:bg-background/95 text-muted-foreground hover:text-foreground"
      :class="{ 'opacity-100': menu.isOpen.value }"
      @click.stop="menu.toggle($event)"
    >
      <Icon icon="mdi:dots-horizontal" class="text-base" />
    </button>

    <!-- Preview -->
    <button class="w-full aspect-video block overflow-hidden rounded-lg" @click="handlePreviewClick">
      <slot name="preview" />
    </button>

    <!-- Info -->
    <div class="px-0.5 py-2">
      <slot name="info" />
    </div>

  </div>

  <!-- Context menu -->
  <ContextMenuRoot :menu="menu">
    <ContextMenuLabel>File</ContextMenuLabel>
    <ContextMenuSeparator />
    <ContextMenuItem icon="mdi:open-in-new" @click="openFile">Open file</ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem icon="mdi:pencil-outline" @click="startRename">Rename</ContextMenuItem>
    <ContextMenuItem icon="mdi:folder-move-outline" @click="moveOpen = true">Move to folder</ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem icon="mdi:delete-outline" destructive @click="confirmDelete = true">Delete</ContextMenuItem>
  </ContextMenuRoot>

  <!-- Rename dialog -->
  <Dialog :open="renameOpen" class="max-w-sm" @close="renameOpen = false">
    <div class="p-6 flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <h3 class="text-base font-semibold">Rename file</h3>
        <button class="text-muted-foreground hover:text-foreground transition-colors" @click="renameOpen = false">✕</button>
      </div>
      <form class="flex flex-col gap-3" @submit.prevent="submitRename">
        <div class="flex flex-col gap-1.5">
          <Label for="rename-input">File name</Label>
          <Input id="rename-input" v-model="renameName" autofocus required />
        </div>
        <p v-if="renameError" class="text-sm text-destructive">{{ renameError }}</p>
        <div class="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" @click="renameOpen = false">Cancel</Button>
          <Button type="submit" :disabled="!renameName.trim() || renameLoading">
            {{ renameLoading ? 'Saving…' : 'Rename' }}
          </Button>
        </div>
      </form>
    </div>
  </Dialog>

  <!-- Move to folder dialog -->
  <SelectFolderDialog
    v-if="companyId"
    :open="moveOpen"
    :company-id="companyId"
    title="Move file to folder"
    @select="doMove"
    @close="moveOpen = false"
  />

  <!-- Confirm delete -->
  <ConfirmDialog
    :open="confirmDelete"
    title="Delete file"
    confirm-label="Delete"
    :loading="deleting"
    destructive
    @confirm="doDelete"
    @cancel="confirmDelete = false"
  >
    Delete "{{ file.name }}"? This cannot be undone.
  </ConfirmDialog>
</template>
