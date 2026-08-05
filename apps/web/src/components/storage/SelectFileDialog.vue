<script setup>
import { Icon } from '@iconify/vue'
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@starling/ui'
import FileExplorer from './FileExplorer.vue'

/**
 * Pick a file from the production's storage.
 *
 * The body is the Files page's own FileExplorer in picker mode — same browsing,
 * same upload, same new-folder — only with narrower tiles and the listing
 * filtered to the types the field accepts.
 */
const props = defineProps({
  open:         { type: Boolean, required: true },
  productionId: { type: String,  required: true },
  title:        { type: String,  default: '' },
  /** Storage types this field accepts, e.g. ['audio', 'image']. */
  fileTypes:    { type: Array,   default: null },
  tileWidth:    { type: Number,  default: 160 },
  /** Offer a "no file" choice for fields where the file is optional. */
  allowNone:    { type: Boolean, default: false },
  noneLabel:    { type: String,  default: '' },
})

defineEmits(['select', 'close'])
</script>

<template>
  <Dialog :open="open" @update:open="!$event && $emit('close')">
    <DialogContent class="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden p-0">
      <DialogHeader class="shrink-0 border-b border-border px-5 py-4">
        <DialogTitle>{{ title || $t('storage.picker.title') }}</DialogTitle>
      </DialogHeader>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <FileExplorer
          picker
          :production-id="productionId"
          :file-types="fileTypes"
          :tile-width="tileWidth"
          @select="$emit('select', $event)"
        />
      </div>

      <div class="flex shrink-0 items-center justify-between gap-2 border-t border-border px-5 py-3">
        <Button v-if="allowNone" size="sm" variant="ghost" @click="$emit('select', null)">
          <Icon icon="mdi:close-circle-outline" class="text-base" />
          {{ noneLabel || $t('storage.picker.none') }}
        </Button>
        <Button size="sm" variant="outline" class="ml-auto" @click="$emit('close')">
          {{ $t('storage.picker.cancel') }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
