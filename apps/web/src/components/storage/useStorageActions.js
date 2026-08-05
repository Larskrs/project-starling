import { ref, computed, toValue } from 'vue'
import { useI18n } from 'vue-i18n'
import { useStorageApi, FOLDER } from './useStorageApi.js'

/**
 * The write side of the browser: rename, move, delete, new folder — for one
 * node or for the whole selection.
 *
 * Only one of these can be in flight at a time, so they share a single
 * `current` descriptor plus loading/error. StorageDialogs reads that and puts
 * the matching dialog on screen, which is why a tile can offer "Rename"
 * without owning a dialog of its own.
 */
export function useStorageActions({ productionId, browser, selection }) {
  const api   = useStorageApi()
  const { t } = useI18n()

  const current = ref(null)   // { type, node? }
  const loading = ref(false)
  const error   = ref('')

  const type = computed(() => current.value?.type ?? null)
  const node = computed(() => current.value?.node ?? null)

  function open(nextType, forNode = null) {
    current.value = { type: nextType, node: forNode }
    loading.value = false
    error.value   = ''
  }

  function close() {
    current.value = null
    loading.value = false
    error.value   = ''
  }

  /** Runs a write, keeps the dialog up with an inline error if it fails. */
  async function attempt(fn, fallbackMessage) {
    loading.value = true
    error.value   = ''
    const { ok, error: err } = await fn()
    loading.value = false
    if (!ok) { error.value = err ?? fallbackMessage; return false }
    return true
  }

  const selectedFiles = () => browser.visibleFiles.value.filter(f => selection.isSelected(f.id))

  // ── Entry points ─────────────────────────────────────────────────────────
  const rename       = (n) => open('rename', n)
  const move         = (n) => open('move', n)
  const remove       = (n) => open('delete', n)
  const newFolder    = ()  => open('new-folder')
  const moveSelected = ()  => open('bulk-move')
  const deleteSelected = () => open('bulk-delete')

  // ── Submits ──────────────────────────────────────────────────────────────
  async function submitRename(name) {
    const target = node.value
    if (!target || name === target.name) return close()
    const ok = await attempt(() => api.rename(target, name), t('storage.renameFailed'))
    if (!ok) return
    browser.patchNode(target, { name })
    close()
  }

  async function submitNewFolder(name) {
    const ok = await attempt(
      () => api.createFolder(toValue(productionId), name, browser.folderId.value),
      t('storage.folder.createFailed'),
    )
    if (!ok) return
    close()
    browser.refresh()
  }

  async function submitMove(folderId) {
    const targets = type.value === 'bulk-move' ? selectedFiles() : [node.value]
    loading.value = true
    await Promise.all(targets.map(f => api.move(f, folderId)))
    loading.value = false
    targets.forEach(browser.removeNode)
    selection.clear()
    close()
  }

  async function confirmDelete() {
    const targets = type.value === 'bulk-delete' ? selectedFiles() : [node.value]
    loading.value = true
    await Promise.all(targets.map(api.remove))
    loading.value = false
    targets.forEach(browser.removeNode)
    selection.clear()
    close()
  }

  async function setHue(folder, hue) {
    const { ok } = await api.setHue(folder, hue)
    if (ok) browser.patchNode({ ...folder, kind: FOLDER }, { hue })
  }

  return {
    current, type, node, loading, error, close,
    rename, move, remove, newFolder, moveSelected, deleteSelected,
    submitRename, submitNewFolder, submitMove, confirmDelete, setHue,
  }
}
