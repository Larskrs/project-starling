import {
  provide, inject, ref, computed, toValue, watch,
  type ComputedRef, type InjectionKey, type MaybeRefOrGetter, type Ref,
} from 'vue'
import { useStorageBrowser, type StorageBrowser } from './useStorageBrowser'
import { useStorageActions, type StorageActions } from './useStorageActions'
import { useUpload, type Upload } from '../../composables/useUpload'
import type { FileNode, StorageFileType } from '../../types/storage'

/**
 * One storage context, assembled once by <StorageBrowser> and read by
 * everything under it — toolbar, grid, tiles, dialogs, preview.
 *
 * That's what lets the Files page and the file-picker dialog be the same
 * explorer: they mount the same root with a different `picker` flag and a
 * different frame around it, and none of the pieces in between need to know
 * which one they're in.
 */

export interface StorageSelection {
  ids: Ref<Set<string>>
  count: ComputedRef<number>
  active: ComputedRef<boolean>
  isSelected: (id: string) => boolean
  toggle: (id: string) => void
  selectAll: (all: string[]) => void
  clear: () => void
}

export interface StoragePreview {
  file: Ref<FileNode | null>
  hasPrev: ComputedRef<boolean>
  hasNext: ComputedRef<boolean>
  open: (file: FileNode) => void
  close: () => void
  prev: () => void
  next: () => void
}

export interface StorageContext {
  productionId: ComputedRef<string>
  picker: ComputedRef<boolean>
  browser: StorageBrowser
  selection: StorageSelection
  actions: StorageActions
  preview: StoragePreview
  upload: Upload
  activate: (file: FileNode) => void
}

export interface ProvideStorageOptions {
  productionId: MaybeRefOrGetter<string>
  fileTypes?: MaybeRefOrGetter<StorageFileType[] | null>
  rootFolderId?: MaybeRefOrGetter<string | null>
  picker?: MaybeRefOrGetter<boolean>
  onPick?: (file: FileNode) => void
}

const STORAGE_KEY: InjectionKey<StorageContext> = Symbol('storage')

function useSelection(): StorageSelection {
  const ids = ref<Set<string>>(new Set())

  return {
    ids,
    count:      computed(() => ids.value.size),
    active:     computed(() => ids.value.size > 0),
    isSelected: (id) => ids.value.has(id),
    toggle(id) {
      const next = new Set(ids.value)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      ids.value = next
    },
    selectAll: (all) => { ids.value = new Set(all) },
    clear:     ()    => { ids.value = new Set() },
  }
}

/** The full-screen preview: which file is open, and stepping through siblings. */
function usePreview(browser: StorageBrowser): StoragePreview {
  const file = ref<FileNode | null>(null)

  const siblings = computed(() => browser.visibleFiles.value)
  const index    = computed(() => siblings.value.findIndex(f => f.id === file.value?.id))
  const hasPrev  = computed(() => index.value > 0)
  const hasNext  = computed(() => index.value !== -1 && index.value < siblings.value.length - 1)

  return {
    file, hasPrev, hasNext,
    open:  (f) => { file.value = f },
    close: ()  => { file.value = null },
    prev:  ()  => { if (hasPrev.value) file.value = siblings.value[index.value - 1] ?? null },
    next:  ()  => { if (hasNext.value) file.value = siblings.value[index.value + 1] ?? null },
  }
}

export function provideStorage(
  { productionId, fileTypes = null, rootFolderId = null, picker = false, onPick }: ProvideStorageOptions,
): StorageContext {
  const browser   = useStorageBrowser({ productionId, rootFolderId, fileTypes })
  const selection = useSelection()
  const actions   = useStorageActions({ productionId, browser, selection })
  const preview   = usePreview(browser)

  const upload = useUpload({
    productionId,
    folderId:   browser.folderId,
    onUploaded: () => { void browser.refresh() },
  })

  // A selection is about what's on screen; walking away from it ends it.
  watch(browser.folderId, () => selection.clear())

  const isPicking = computed(() => !!toValue(picker))

  /** What a click on a file tile means, which is the only difference between the two modes. */
  function activate(file: FileNode): void {
    if (isPicking.value) onPick?.(file)
    else if (selection.active.value) selection.toggle(file.id)
    else preview.open(file)
  }

  const ctx: StorageContext = {
    productionId: computed(() => toValue(productionId)),
    picker: isPicking,
    browser, selection, actions, preview, upload, activate,
  }

  provide(STORAGE_KEY, ctx)
  return ctx
}

export function useStorage(): StorageContext {
  const ctx = inject(STORAGE_KEY, null)
  if (!ctx) throw new Error('useStorage() must be called inside a <StorageBrowser>')
  return ctx
}
