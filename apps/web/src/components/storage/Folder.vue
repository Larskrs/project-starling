<script setup>
import { ref, computed, inject, onMounted } from 'vue'
import { Icon } from '@iconify/vue'
import { useContextMenu } from '../../composables/useContextMenu.js'
import { useColorMode }  from '../../composables/useColorMode.js'
import { useApi }        from '../../composables/useApi.js'
import ContextMenuRoot      from '../ui/ContextMenuRoot.vue'
import ContextMenuItem      from '../ui/ContextMenuItem.vue'
import ContextMenuSub       from '../ui/ContextMenuSub.vue'
import ContextMenuSeparator from '../ui/ContextMenuSeparator.vue'
import ContextMenuLabel     from '../ui/ContextMenuLabel.vue'
import ConfirmDialog        from '../ui/ConfirmDialog.vue'
import Dialog               from '../ui/Dialog.vue'
import Button               from '../ui/Button.vue'
import Input                from '../ui/Input.vue'
import Label                from '../ui/Label.vue'

const props = defineProps({ folder: { type: Object, required: true } })
const emit  = defineEmits(['open', 'hue-change', 'deleted', 'renamed'])
const menu  = useContextMenu()
const { isDark } = useColorMode()
const { $fetch } = useApi()

// ── File peek previews ────────────────────────────────────────────────────────
const productionId = inject('storage-production-id', null)
const previewFiles = ref([])

onMounted(async () => {
  if (!productionId || !props.folder.fileCount) return
  const params = new URLSearchParams({ pid: productionId, folder_id: props.folder.id })
  const { ok, data } = await $fetch(`/api/storage?${params}`, { silent: true })
  if (ok) previewFiles.value = data.files.slice(0, 3)
})

const isHovered = ref(false)

const PEEK_STYLES_DEFAULT = [
  { transform: 'rotate(-11deg) translate(-7px, 3px) scale(0.86)', zIndex: 1 },
  { transform: 'rotate(-3deg)  translate(-1px, 1px) scale(0.93)', zIndex: 2 },
  { transform: 'rotate(8deg)   translate(5px, -1px) scale(1)',    zIndex: 3 },
]

const PEEK_STYLES_HOVER = [
  { transform: 'rotate(-15deg) translate(-13px, 4px) scale(0.84)', zIndex: 1 },
  { transform: 'rotate(-4deg)  translate(-1px,  2px) scale(0.92)', zIndex: 2 },
  { transform: 'rotate(13deg)  translate(11px, -2px) scale(1)',    zIndex: 3 },
]

const peekStyles = computed(() => isHovered.value ? PEEK_STYLES_HOVER : PEEK_STYLES_DEFAULT)

function fileThumbnailSrc(file) {
  if (file.type !== 'image' || !file.versions?.length) return null
  const best = [...file.versions].sort((a, b) => a.quality - b.quality)[0]
  return `/api/storage/${file.id}/serve?quality=${best.quality}`
}

function fileTypeIcon(file) {
  if (file.type === 'image') return 'mdi:image-outline'
  if (file.type === 'audio') return 'mdi:music-note'
  return 'mdi:file-outline'
}

// ── Rename ────────────────────────────────────────────────────────────────────
const renameOpen    = ref(false)
const renameName    = ref('')
const renameLoading = ref(false)
const renameError   = ref('')

function startRename() {
  renameName.value  = props.folder.name
  renameError.value = ''
  renameOpen.value  = true
}

async function submitRename() {
  const name = renameName.value.trim()
  if (!name || name === props.folder.name) { renameOpen.value = false; return }
  renameLoading.value = true
  renameError.value   = ''
  const { ok, error } = await $fetch(`/api/storage/folders/${props.folder.id}`, {
    method: 'PATCH', json: { name }, silent: true,
  })
  renameLoading.value = false
  if (!ok) { renameError.value = error ?? 'Rename failed'; return }
  renameOpen.value = false
  emit('renamed', { id: props.folder.id, name })
}

// ── Delete ────────────────────────────────────────────────────────────────────
const confirmDelete = ref(false)
const deleting      = ref(false)

async function deleteFolder() {
  deleting.value = true
  const { ok } = await $fetch(`/api/storage/folders/${props.folder.id}`, { method: 'DELETE' })
  deleting.value = false
  if (!ok) return
  confirmDelete.value = false
  emit('deleted', props.folder.id)
}

const HUE_PRESETS = [
  { label: 'Default', hue: null },
  { label: 'Red',     hue: 20  },
  { label: 'Orange',  hue: 55  },
  { label: 'Yellow',  hue: 90  },
  { label: 'Green',   hue: 135 },
  { label: 'Teal',    hue: 185 },
  { label: 'Blue',    hue: 240 },
  { label: 'Purple',  hue: 285 },
  { label: 'Pink',    hue: 330 },
]

function swatchStyle(hue) {
  return hue == null
    ? { background: 'transparent', borderStyle: 'dashed', borderColor: 'currentColor', opacity: '0.45' }
    : { background: `oklch(0.72 0.20 ${hue})`, borderColor: 'transparent' }
}
</script>

<template>
  <div
    class="folder-card isolate relative flex items-center rounded-lg transition-colors"
    :class="{ 'folder-card--hued': folder.hue != null }"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
    @contextmenu.prevent="menu.open($event)"
    :style="folder.hue != null ? (isDark ? {
      '--bg':    `oklch(0.58 0.25 ${folder.hue} / 0.3)`,
      '--hover': `oklch(0.64 0.25 ${folder.hue} / 0.5)`,
      '--icon':  `oklch(0.72 0.20 ${folder.hue})`,
    } : {
      '--bg':    `oklch(0.88 0.07 ${folder.hue} / 0.6)`,
      '--hover': `oklch(0.85 0.09 ${folder.hue} / 0.8)`,
      '--icon':  `oklch(0.52 0.18 ${folder.hue})`,
    }) : null"
  >
    <!-- File peek previews -->
    <Transition name="peek">
      <div
        v-if="previewFiles.length"
        class="peek-cards absolute pointer-events-none"
        style="top: 0; right: 40px;"
      >
        <div class="relative" style="width: 52px; height: 36px;">
          <div
            v-for="(file, i) in previewFiles"
            :key="file.id"
            class="absolute inset-0 rounded overflow-hidden shadow-lg bg-muted peek-card"
            style="border: 1px solid oklch(1 0 0 / 0.1);"
            :style="peekStyles[i]"
          >
            <img
              v-if="fileThumbnailSrc(file)"
              :src="fileThumbnailSrc(file)"
              class="w-full h-full object-cover"
            />
            <div v-else class="w-full h-full flex items-center justify-center">
              <Icon :icon="fileTypeIcon(file)" class="text-lg text-foreground/50" />
            </div>
          </div>
        </div>
      </div>
    </Transition>
    <button
      class="flex-1 flex items-center gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-l-lg min-w-0"
      @click="$emit('open', folder)"
    >
      <Icon
        icon="mdi:folder"
        class="text-xl shrink-0"
        :class="folder.hue == null ? 'text-primary' : ''"
        :style="folder.hue != null ? { color: 'var(--icon)' } : null"
      />
      <span class="text-base font-medium text-foreground truncate">{{ folder.name }}</span>
    </button>

    <button
      class="group shrink-0 mx-1.5 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :class="{ 'bg-foreground/10 text-foreground': menu.isOpen.value }"
      aria-label="Folder options"
      @click.stop="menu.toggle($event)"
    >
      <Icon icon="mdi:dots-horizontal" class="size-5" />
    </button>
  </div>

  <ContextMenuRoot :menu="menu">
    <ContextMenuLabel>Folder</ContextMenuLabel>
    <ContextMenuSeparator />
    <ContextMenuSub label="Color" icon="mdi:palette-outline">
      <ContextMenuLabel>Hue</ContextMenuLabel>
      <ContextMenuItem
        v-for="preset in HUE_PRESETS"
        :key="preset.label"
        :shortcut="folder.hue === preset.hue ? '✓' : ''"
        @click="emit('hue-change', { folder, hue: preset.hue })"
      >
        <template #icon>
          <span class="size-3.5 rounded-full shrink-0 border-2 inline-block" :style="swatchStyle(preset.hue)" />
        </template>
        <span :class="{ 'font-medium': folder.hue === preset.hue }">{{ preset.label }}</span>
      </ContextMenuItem>
    </ContextMenuSub>
    <ContextMenuSeparator />
    <ContextMenuItem icon="mdi:folder-open-outline" @click="$emit('open', folder)">
      Open folder
    </ContextMenuItem>
    <ContextMenuItem icon="mdi:pencil-outline" @click="startRename">
      Rename folder
    </ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem icon="mdi:delete-outline" destructive @click="confirmDelete = true">
      Delete folder
    </ContextMenuItem>
  </ContextMenuRoot>

  <Dialog :open="renameOpen" class="max-w-sm" @close="renameOpen = false">
    <div class="p-6 flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <h3 class="text-base font-semibold">Rename folder</h3>
        <button class="text-muted-foreground hover:text-foreground transition-colors" @click="renameOpen = false">✕</button>
      </div>
      <form class="flex flex-col gap-3" @submit.prevent="submitRename">
        <div class="flex flex-col gap-1.5">
          <Label for="rename-folder-input">Folder name</Label>
          <Input id="rename-folder-input" v-model="renameName" autofocus required />
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

  <ConfirmDialog
    :open="confirmDelete"
    title="Delete folder"
    confirm-label="Delete folder"
    :loading="deleting"
    destructive
    @confirm="deleteFolder"
    @cancel="confirmDelete = false"
  >
    <template v-if="folder.fileCount > 0 || folder.folderCount > 0">
      Are you sure you wish to delete this folder, and its
      <template v-if="folder.folderCount > 0">
        <b class="text-foreground font-semibold">{{ folder.folderCount }} {{ folder.folderCount === 1 ? 'subfolder' : 'subfolders' }}</b>
        and
      </template>
      <b class="text-foreground font-semibold">{{ folder.fileCount }} {{ folder.fileCount === 1 ? 'file' : 'files' }}</b>
      contained within it?
    </template>
    <template v-else>Are you sure you wish to delete this folder?</template>
  </ConfirmDialog>
</template>

<style scoped>
.folder-card       { background-color: oklch(var(--muted) / 0.88); }
.folder-card:hover { background-color: oklch(var(--secondary) / 1.5); }

.folder-card--hued       { background-color: var(--bg); }
.folder-card--hued:hover { background-color: var(--hover); }

.peek-cards              { z-index: -1; transform: translateY(-62%); transition: transform 0.25s ease; }
.folder-card:hover .peek-cards { transform: translateY(-75%); }

.peek-card { transition: transform 0.25s ease; }

.peek-enter-active { transition: opacity 0.3s ease, transform 0.3s ease; }
.peek-enter-from   { opacity: 0; transform: translateY(-45%) scale(0.85); }
.peek-enter-to     { opacity: 1; transform: translateY(-62%); }
</style>
