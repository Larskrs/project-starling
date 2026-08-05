<script setup>
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import {
  Button, Dialog, DialogContent, DialogHeader, DialogTitle, EmptyState, Input, Label, Spinner,
} from '@starling/ui'
import StorageBreadcrumb from './StorageBreadcrumb.vue'
import { useStorageBrowser } from './useStorageBrowser.js'
import { useStorageApi } from './useStorageApi.js'

/**
 * Pick a destination folder. Runs on the same browser as the file explorer,
 * showing only the folder half of it — so navigation behaves identically, and
 * a new folder can be made without leaving the dialog.
 */
const props = defineProps({
  open:         { type: Boolean, required: true },
  productionId: { type: String,  required: true },
  title:        { type: String,  default: '' },
})

const emit = defineEmits(['select', 'close'])

const { t }   = useI18n()
const api     = useStorageApi()
const browser = useStorageBrowser({ productionId: () => props.productionId })
const { folders, loading, crumbs, folderId, openFolder, goToCrumb, reset, refresh } = browser

// ── Inline new folder ─────────────────────────────────────────────────────
const creating      = ref(false)
const newName       = ref('')
const createError   = ref('')
const createLoading = ref(false)

function toggleCreating() {
  creating.value    = !creating.value
  newName.value     = ''
  createError.value = ''
}

async function submitCreate() {
  createError.value   = ''
  createLoading.value = true
  const { ok, error } = await api.createFolder(props.productionId, newName.value.trim(), folderId.value)
  createLoading.value = false
  if (!ok) { createError.value = error ?? t('storage.folder.createFailed'); return }
  creating.value = false
  newName.value  = ''
  refresh()
}

// Always reopens at the root: the destination is chosen fresh each time.
watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  creating.value = false
  reset(null)
})
</script>

<template>
  <Dialog :open="open" @update:open="!$event && emit('close')">
    <DialogContent class="max-w-sm flex flex-col p-0">
      <DialogHeader class="px-5 py-4 border-b border-border">
        <DialogTitle>{{ title || $t('storage.folder.selectTitle') }}</DialogTitle>
      </DialogHeader>

      <div class="px-4 py-2.5 border-b border-border">
        <StorageBreadcrumb size="sm" :crumbs="crumbs" @navigate="goToCrumb($event)" />
      </div>

      <div class="flex flex-col gap-0.5 px-2 py-2 min-h-[150px] max-h-[260px] overflow-y-auto">
        <div v-if="loading" class="flex items-center justify-center py-10">
          <Spinner class="text-2xl text-muted-foreground/50" />
        </div>

        <EmptyState v-else-if="!folders.length" class="py-8">
          {{ $t('storage.folder.noSubfolders') }}
        </EmptyState>

        <template v-else>
          <button
            v-for="folder in folders"
            :key="folder.id"
            class="flex items-center gap-3 px-3 py-2 rounded-md text-left hover:bg-muted transition-colors"
            @click="openFolder(folder)"
          >
            <Icon icon="mdi:folder" class="text-primary text-lg shrink-0" />
            <span class="flex-1 truncate text-foreground text-sm">{{ folder.name }}</span>
            <Icon icon="mdi:chevron-right" class="text-muted-foreground/40 text-base shrink-0" />
          </button>
        </template>
      </div>

      <form
        v-if="creating"
        class="flex flex-col gap-2 px-3 py-2.5 border-t border-border bg-card mt-1"
        @submit.prevent="submitCreate"
      >
        <Label for="sfd-name" class="text-sm">{{ $t('storage.folder.nameLabel') }}</Label>
        <div class="flex gap-1">
          <Input
            id="sfd-name"
            v-model="newName"
            :placeholder="$t('storage.folder.namePlaceholder')"
            autofocus
            class="h-9 text-sm"
          />
          <Button type="button" size="sm" variant="ghost" @click="toggleCreating">
            <Icon icon="mdi:close" />
          </Button>
          <Button type="submit" size="sm" :disabled="!newName.trim() || createLoading">
            {{ createLoading ? '…' : $t('storage.folder.create') }}
          </Button>
        </div>
        <p v-if="createError" class="text-sm text-destructive">{{ createError }}</p>
      </form>

      <div class="flex items-center justify-between px-4 py-3 border-t border-border">
        <Button size="sm" variant="ghost" @click="toggleCreating">
          <Icon icon="mdi:folder-plus-outline" class="mr-1.5 text-base" />
          {{ $t('storage.newFolder') }}
        </Button>
        <div class="flex gap-2">
          <Button size="sm" variant="outline" @click="emit('close')">{{ $t('storage.cancel') }}</Button>
          <Button size="sm" @click="emit('select', folderId)">{{ $t('storage.folder.moveHere') }}</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
