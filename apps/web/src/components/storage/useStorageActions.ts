import { ref, computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorageApi, FOLDER } from './useStorageApi'
import type { FetchResult } from '../../composables/useApi'
import type { FileNode, FolderNode, StorageNode } from '../../types/storage'
import type { StorageBrowser } from './useStorageBrowser'
import type { StorageSelection } from './storage'

/** Which dialog StorageDialogs should put on screen. */
export type StorageActionType =
  | 'rename' | 'move' | 'delete' | 'new-folder' | 'bulk-move' | 'bulk-delete'

interface CurrentAction {
  type: StorageActionType
  node: StorageNode | null
}

export interface StorageActionsOptions {
  productionId: MaybeRefOrGetter<string>
  browser: StorageBrowser
  selection: StorageSelection
}

/**
 * The write side of the browser: rename, move, delete, new folder — for one
 * node or for the whole selection.
 *
 * Only one of these can be in flight at a time, so they share a single
 * `current` descriptor plus loading/error. StorageDialogs reads that and puts
 * the matching dialog on screen, which is why a tile can offer "Rename"
 * without owning a dialog of its own.
 */
export function useStorageActions({ productionId, browser, selection }: StorageActionsOptions) {
  const api   = useStorageApi()
  const { t } = useI18n()

  const current = ref<CurrentAction | null>(null)
  const loading = ref(false)
  const error   = ref('')

  const type = computed<StorageActionType | null>(() => current.value?.type ?? null)
  const node = computed<StorageNode | null>(() => current.value?.node ?? null)

  function open(nextType: StorageActionType, forNode: StorageNode | null = null): void {
    current.value = { type: nextType, node: forNode }
    loading.value = false
    error.value   = ''
  }

  function close(): void {
    current.value = null
    loading.value = false
    error.value   = ''
  }

  /** Runs a write, keeps the dialog up with an inline error if it fails. */
  async function attempt(
    fn: () => Promise<FetchResult<unknown>>,
    fallbackMessage: string,
  ): Promise<boolean> {
    loading.value = true
    error.value   = ''
    const { ok, error: err } = await fn()
    loading.value = false
    if (!ok) { error.value = err ?? fallbackMessage; return false }
    return true
  }

  const selectedFiles = (): FileNode[] =>
    browser.visibleFiles.value.filter(f => selection.isSelected(f.id))

  // ── Entry points ─────────────────────────────────────────────────────────
  const rename         = (n: StorageNode) => open('rename', n)
  const move           = (n: FileNode)    => open('move', n)
  const remove         = (n: StorageNode) => open('delete', n)
  const newFolder      = ()               => open('new-folder')
  const moveSelected   = ()               => open('bulk-move')
  const deleteSelected = ()               => open('bulk-delete')

  // ── Submits ──────────────────────────────────────────────────────────────
  async function submitRename(name: string): Promise<void> {
    const target = node.value
    if (!target || name === target.name) return close()
    const ok = await attempt(() => api.rename(target, name), t('storage.renameFailed'))
    if (!ok) return
    browser.patchNode(target, { name })
    close()
  }

  async function submitNewFolder(name: string): Promise<void> {
    const ok = await attempt(
      () => api.createFolder(toValue(productionId), name, browser.folderId.value),
      t('storage.folder.createFailed'),
    )
    if (!ok) return
    close()
    void browser.refresh()
  }

  /** Only files are movable, so a single-node move is always a file. */
  function moveTargets(): FileNode[] {
    if (type.value === 'bulk-move') return selectedFiles()
    const target = node.value
    return target && target.kind !== FOLDER ? [target] : []
  }

  async function submitMove(folderId: string | null): Promise<void> {
    const targets = moveTargets()
    loading.value = true
    await Promise.all(targets.map(f => api.move(f, folderId)))
    loading.value = false
    targets.forEach(f => browser.removeNode(f))
    selection.clear()
    close()
  }

  async function confirmDelete(): Promise<void> {
    const targets: StorageNode[] = type.value === 'bulk-delete'
      ? selectedFiles()
      : (node.value ? [node.value] : [])
    loading.value = true
    await Promise.all(targets.map(n => api.remove(n)))
    loading.value = false
    targets.forEach(n => browser.removeNode(n))
    selection.clear()
    close()
  }

  async function setHue(folder: FolderNode, hue: number | null): Promise<void> {
    const { ok } = await api.setHue(folder, hue)
    if (ok) browser.patchNode({ ...folder, kind: FOLDER }, { hue })
  }

  return {
    current, type, node, loading, error, close,
    rename, move, remove, newFolder, moveSelected, deleteSelected,
    submitRename, submitNewFolder, submitMove, confirmDelete, setHue,
  }
}

export type StorageActions = ReturnType<typeof useStorageActions>
