<script setup>
import { ref } from 'vue'
import { Icon } from '@iconify/vue'
import { useContextMenu } from '../../composables/useContextMenu.js'
import ContextMenuRoot      from '../ui/ContextMenuRoot.vue'
import ContextMenuItem      from '../ui/ContextMenuItem.vue'
import ContextMenuSub       from '../ui/ContextMenuSub.vue'
import ContextMenuSeparator from '../ui/ContextMenuSeparator.vue'
import ContextMenuLabel     from '../ui/ContextMenuLabel.vue'
import ConfirmDialog        from '../ui/ConfirmDialog.vue'

const props = defineProps({ folder: { type: Object, required: true } })
const emit  = defineEmits(['open', 'hue-change', 'deleted'])
const menu  = useContextMenu()

const confirmDelete = ref(false)
const deleting      = ref(false)

async function deleteFolder() {
  deleting.value = true
  try {
    const res = await fetch(`/api/storage/folders/${props.folder.id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (!res.ok) return
    confirmDelete.value = false
    emit('deleted', props.folder.id)
  } finally {
    deleting.value = false
  }
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
    : { background: `oklch(0.65 0.18 ${hue})`, borderColor: 'transparent' }
}
</script>

<template>
  <div
    class="folder-card flex items-center rounded-lg transition-colors"
    :class="{ 'folder-card--hued': folder.hue != null }"
    :style="folder.hue != null ? {
      '--bg':    `oklch(0.40 0.1 ${folder.hue} / 0.3)`,
      '--hover': `oklch(0.40 0.12 ${folder.hue} / 0.5)`,
      '--icon':  `oklch(0.72 0.18 ${folder.hue})`,
    } : null"
  >
    <button
      class="flex-1 flex items-center gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-l-lg min-w-0"
      @click="$emit('open', folder)"
    >
      <Icon
        icon="mdi:folder"
        class="text-xl shrink-0"
        :class="folder.hue == null ? 'text-blue-400' : ''"
        :style="folder.hue != null ? { color: 'var(--icon)' } : null"
      />
      <span class="text-base font-medium text-foreground truncate">{{ folder.name }}</span>
    </button>

    <button
      class="group shrink-0 mx-1.5 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-background/50 dark:hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :class="{ 'bg-background/50 text-foreground': menu.isOpen.value }"
      aria-label="Folder options"
      @click.stop="menu.toggle($event)"
    >
      <Icon icon="mdi:dots-horizontal" class="text-white/50 group-hover:text-white/75 size-5" />
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
    <ContextMenuSeparator />
    <ContextMenuItem icon="mdi:delete-outline" destructive @click="confirmDelete = true">
      Delete folder
    </ContextMenuItem>
  </ContextMenuRoot>

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
</style>
