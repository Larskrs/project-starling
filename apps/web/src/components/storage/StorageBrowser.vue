<script setup>
import { onMounted, toRef } from 'vue'
import DropZone            from './DropZone.vue'
import StorageToolbar      from './StorageToolbar.vue'
import StorageSelectionBar from './StorageSelectionBar.vue'
import StorageUploadQueue  from './StorageUploadQueue.vue'
import StorageGrid         from './StorageGrid.vue'
import StorageDialogs      from './StorageDialogs.vue'
import FilePreview         from './FilePreview.vue'
import { provideStorage }  from './storage.js'

/**
 * The file explorer, whole. The Files page mounts it as the page; the file
 * picker mounts it inside a dialog with `picker` set — same browsing, same
 * upload, same new folder, one implementation.
 *
 * Each region is a slot, so a host that wants its own chrome (a toolbar in a
 * dialog header, no upload queue) replaces just that part.
 */
const props = defineProps({
  productionId: { type: String,  required: true },
  /**
   * Picker mode: a file click emits `pick` instead of opening the preview, and
   * the per-file management affordances step out of the way.
   */
  picker:       { type: Boolean, default: false },
  /** Show only these storage types (e.g. ['audio', 'image']); null = all. */
  fileTypes:    { type: Array,   default: null },
  tileWidth:    { type: Number,  default: 230 },
  rootFolderId: { type: String,  default: null },
})

const emit = defineEmits(['pick'])

const { browser, preview, upload } = provideStorage({
  productionId: toRef(props, 'productionId'),
  fileTypes:    toRef(props, 'fileTypes'),
  rootFolderId: toRef(props, 'rootFolderId'),
  picker:       toRef(props, 'picker'),
  onPick:       (file) => emit('pick', file),
})

const { file: previewFile } = preview

onMounted(browser.load)

defineExpose({ browser, refresh: browser.refresh })
</script>

<template>
  <div class="relative flex flex-col gap-4">
    <slot name="toolbar"><StorageToolbar /></slot>

    <slot name="selection">
      <StorageSelectionBar v-if="!picker" />
    </slot>

    <slot name="queue"><StorageUploadQueue /></slot>

    <DropZone @drop="upload.uploadFiles($event)">
      <slot><StorageGrid :tile-width="tileWidth" /></slot>
    </DropZone>

    <Transition name="preview">
      <FilePreview v-if="previewFile" />
    </Transition>

    <StorageDialogs />
  </div>
</template>

<style scoped>
.preview-enter-active, .preview-leave-active { transition: opacity 0.15s; }
.preview-enter-from,   .preview-leave-to     { opacity: 0; }
</style>
