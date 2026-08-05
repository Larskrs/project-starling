<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ConfirmDialog, PromptDialog } from '@starling/ui'
import SelectFolderDialog from './SelectFolderDialog.vue'
import { useStorage } from './storage.js'
import { FOLDER } from './useStorageApi.js'

/**
 * Every write dialog the browser can raise, mounted once at the root.
 *
 * Tiles and the selection bar only say what they want done — which is why a
 * grid of fifty files doesn't carry fifty copies of a rename dialog.
 */
const { productionId, selection, actions } = useStorage()
const { type, node, loading, error, close } = actions

const { t } = useI18n()

const isFolder = computed(() => node.value?.kind === FOLDER)
const isBulk   = computed(() => type.value?.startsWith('bulk-'))

const renameTitle = computed(() => isFolder.value ? t('storage.folder.renameTitle') : t('storage.file.renameTitle'))
const renameLabel = computed(() => isFolder.value ? t('storage.folder.nameLabel')   : t('storage.file.nameLabel'))

const moveTitle = computed(() => isBulk.value ? t('storage.file.bulkMoveTitle') : t('storage.file.moveTitle'))

const deleteTitle = computed(() =>
  isBulk.value   ? t('storage.file.bulkDeleteTitle')
  : isFolder.value ? t('storage.folder.deleteTitle')
  :                  t('storage.file.deleteTitle'))

const deleteBody = computed(() => {
  if (isBulk.value)   return t('storage.file.bulkDeleteBody', { files: t('storage.count.files', selection.count.value) })
  if (!isFolder.value) return t('storage.file.deleteBody', { name: node.value?.name })

  const files   = node.value?.fileCount   ?? 0
  const folders = node.value?.folderCount ?? 0
  if (folders) return t('storage.folder.deleteBodyAll',   { folders: t('storage.count.folders', folders), files: t('storage.count.files', files) })
  if (files)   return t('storage.folder.deleteBodyFiles', { files: t('storage.count.files', files) })
  return t('storage.folder.deleteBody')
})
</script>

<template>
  <PromptDialog
    :open="type === 'rename'"
    :title="renameTitle"
    :label="renameLabel"
    :initial-value="node?.name ?? ''"
    :submit-label="$t('storage.rename')"
    :cancel-label="$t('storage.cancel')"
    :loading="loading"
    :error="error"
    @update:open="!$event && close()"
    @submit="actions.submitRename($event)"
  />

  <PromptDialog
    :open="type === 'new-folder'"
    :title="$t('storage.folder.createTitle')"
    :label="$t('storage.folder.nameLabel')"
    :placeholder="$t('storage.folder.namePlaceholder')"
    :submit-label="$t('storage.folder.create')"
    :cancel-label="$t('storage.cancel')"
    :loading="loading"
    :error="error"
    @update:open="!$event && close()"
    @submit="actions.submitNewFolder($event)"
  />

  <SelectFolderDialog
    :open="type === 'move' || type === 'bulk-move'"
    :production-id="productionId"
    :title="moveTitle"
    @select="actions.submitMove($event)"
    @close="close()"
  />

  <ConfirmDialog
    :open="type === 'delete' || type === 'bulk-delete'"
    :title="deleteTitle"
    :confirm-label="$t('storage.delete')"
    :cancel-label="$t('storage.cancel')"
    :loading="loading"
    destructive
    @confirm="actions.confirmDelete()"
    @cancel="close()"
  >
    {{ deleteBody }}
  </ConfirmDialog>
</template>
