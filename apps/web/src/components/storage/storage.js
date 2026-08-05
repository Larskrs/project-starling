import { provide, inject, ref, computed, toValue, watch } from 'vue'
import { useStorageBrowser } from './useStorageBrowser.js'
import { useStorageActions } from './useStorageActions.js'
import { useUpload } from '../../composables/useUpload.js'

/**
 * One storage context, assembled once by <StorageBrowser> and read by
 * everything under it — toolbar, grid, tiles, dialogs, preview.
 *
 * That's what lets the Files page and the file-picker dialog be the same
 * explorer: they mount the same root with a different `picker` flag and a
 * different frame around it, and none of the pieces in between need to know
 * which one they're in.
 */
const STORAGE_KEY = Symbol('storage')

function useSelection() {
  const ids = ref(new Set())

  return {
    ids,
    count:      computed(() => ids.value.size),
    active:     computed(() => ids.value.size > 0),
    isSelected: (id) => ids.value.has(id),
    toggle(id) {
      const next = new Set(ids.value)
      next.has(id) ? next.delete(id) : next.add(id)
      ids.value = next
    },
    selectAll: (all) => { ids.value = new Set(all) },
    clear:     ()    => { ids.value = new Set() },
  }
}

/** The full-screen preview: which file is open, and stepping through siblings. */
function usePreview(browser) {
  const file = ref(null)

  const siblings = computed(() => browser.visibleFiles.value)
  const index    = computed(() => siblings.value.findIndex(f => f.id === file.value?.id))
  const hasPrev  = computed(() => index.value > 0)
  const hasNext  = computed(() => index.value !== -1 && index.value < siblings.value.length - 1)

  return {
    file, hasPrev, hasNext,
    open:  (f) => { file.value = f },
    close: ()  => { file.value = null },
    prev:  ()  => { if (hasPrev.value) file.value = siblings.value[index.value - 1] },
    next:  ()  => { if (hasNext.value) file.value = siblings.value[index.value + 1] },
  }
}

/**
 * @param {{
 *   productionId: string | (() => string) | import('vue').Ref<string>,
 *   fileTypes?:    string[] | (() => string[]) | import('vue').Ref<string[]>,
 *   rootFolderId?: string | (() => string) | import('vue').Ref<string>,
 *   picker?:       boolean | (() => boolean) | import('vue').Ref<boolean>,
 *   onPick?:       (file: object) => void,
 * }} options
 */
export function provideStorage({ productionId, fileTypes = null, rootFolderId = null, picker = false, onPick } = {}) {
  const browser   = useStorageBrowser({ productionId, rootFolderId, fileTypes })
  const selection = useSelection()
  const actions   = useStorageActions({ productionId, browser, selection })
  const preview   = usePreview(browser)

  const upload = useUpload({
    productionId,
    folderId:   browser.folderId,
    onUploaded: () => browser.refresh(),
  })

  // A selection is about what's on screen; walking away from it ends it.
  watch(browser.folderId, () => selection.clear())

  const isPicking = computed(() => !!toValue(picker))

  /** What a click on a file tile means, which is the only difference between the two modes. */
  function activate(file) {
    if (isPicking.value) onPick?.(file)
    else if (selection.active.value) selection.toggle(file.id)
    else preview.open(file)
  }

  const ctx = {
    productionId: computed(() => toValue(productionId)),
    picker: isPicking,
    browser, selection, actions, preview, upload, activate,
  }

  provide(STORAGE_KEY, ctx)
  return ctx
}

export function useStorage() {
  const ctx = inject(STORAGE_KEY, null)
  if (!ctx) throw new Error('useStorage() must be called inside a <StorageBrowser>')
  return ctx
}
