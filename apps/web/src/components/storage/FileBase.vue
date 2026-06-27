<script setup>
import { ref, computed, inject } from 'vue'
import { Icon } from '@iconify/vue'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'radix-vue'
import { useFileSelection }    from '../../composables/useFileSelection.js'
import { useApi }              from '../../composables/useApi.js'
import DropdownMenuContent     from '@starling/ui/DropdownMenuContent'
import DropdownMenuItem        from '@starling/ui/DropdownMenuItem'
import DropdownMenuSeparator   from '@starling/ui/DropdownMenuSeparator'
import DropdownMenuLabel       from '@starling/ui/DropdownMenuLabel'
import ConfirmDialog           from '@starling/ui/ConfirmDialog'
import SelectFolderDialog      from './SelectFolderDialog.vue'
import Dialog        from '@starling/ui/Dialog'
import DialogContent from '@starling/ui/DialogContent'
import DialogHeader  from '@starling/ui/DialogHeader'
import DialogTitle   from '@starling/ui/DialogTitle'
import DialogFooter  from '@starling/ui/DialogFooter'
import Button                  from '@starling/ui/Button'
import Input                   from '@starling/ui/Input'
import Label                   from '@starling/ui/Label'

const props = defineProps({ file: { type: Object, required: true } })
const emit  = defineEmits(['select', 'delete', 'renamed', 'moved'])

const productionId = inject('storage-production-id', null)
const menuOpen  = ref(false)
const { $fetch } = useApi()

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
  const { ok, error } = await $fetch(`/api/storage/${props.file.id}`, {
    method: 'PATCH', json: { name }, silent: true,
  })
  renameLoading.value = false
  if (!ok) { renameError.value = error ?? 'Rename failed'; return }
  renameOpen.value = false
  emit('renamed', { id: props.file.id, name })
}

// ── Move ──────────────────────────────────────────────────────────────────────
const moveOpen    = ref(false)
const moveLoading = ref(false)

async function doMove(folderId) {
  moveLoading.value = true
  const { ok } = await $fetch(`/api/storage/${props.file.id}`, {
    method: 'PATCH', json: { folder_id: folderId },
  })
  moveLoading.value = false
  if (!ok) return
  moveOpen.value = false
  emit('moved', props.file.id)
}

// ── Delete ────────────────────────────────────────────────────────────────────
const confirmDelete = ref(false)
const deleting      = ref(false)

async function doDelete() {
  deleting.value = true
  const { ok } = await $fetch(`/api/storage/${props.file.id}`, { method: 'DELETE' })
  deleting.value = false
  if (!ok) return
  confirmDelete.value = false
  emit('delete', props.file)
}
</script>

<template>
  <DropdownMenuRoot v-model:open="menuOpen">
    <div
      class="group relative rounded-lg overflow-hidden transition-all"
      :class="selected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''"
      @contextmenu.prevent="menuOpen = true"
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

      <!-- Dots trigger (top-right) -->
      <DropdownMenuTrigger as-child>
        <button
          class="absolute top-1.5 right-1.5 z-10 p-1 rounded transition-opacity opacity-0 group-hover:opacity-100 bg-background/70 hover:bg-background/95 text-muted-foreground hover:text-foreground"
          :class="{ 'opacity-100': menuOpen }"
          @click.stop
        >
          <Icon icon="mdi:dots-horizontal" class="text-base" />
        </button>
      </DropdownMenuTrigger>

      <!-- Preview -->
      <button class="w-full aspect-video block overflow-hidden rounded-lg" @click="handlePreviewClick">
        <slot name="preview" />
      </button>

      <!-- Info -->
      <div class="px-0.5 py-2">
        <slot name="info" />
      </div>
    </div>

    <DropdownMenuContent align="end">
      <DropdownMenuLabel>File</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem icon="mdi:open-in-new" @click="openFile">Open file</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem icon="mdi:pencil-outline" @click="startRename">Rename</DropdownMenuItem>
      <DropdownMenuItem icon="mdi:folder-move-outline" @click="moveOpen = true">Move to folder</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem icon="mdi:delete-outline" destructive @click="confirmDelete = true">Delete</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenuRoot>

  <!-- Rename dialog -->
  <Dialog :open="renameOpen" @update:open="!$event && (renameOpen = false)">
    <DialogContent class="max-w-sm p-6 flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Rename file</DialogTitle>
      </DialogHeader>
      <form class="flex flex-col gap-3" @submit.prevent="submitRename">
        <div class="flex flex-col gap-1.5">
          <Label for="rename-input">File name</Label>
          <Input id="rename-input" v-model="renameName" autofocus required />
        </div>
        <p v-if="renameError" class="text-sm text-destructive">{{ renameError }}</p>
        <DialogFooter class="pt-1">
          <Button type="button" variant="outline" @click="renameOpen = false">Cancel</Button>
          <Button type="submit" :disabled="!renameName.trim() || renameLoading">
            {{ renameLoading ? 'Saving…' : 'Rename' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>

  <!-- Move to folder dialog -->
  <SelectFolderDialog
    v-if="productionId"
    :open="moveOpen"
    :production-id="productionId"
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
