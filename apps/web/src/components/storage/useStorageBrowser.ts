import { ref, computed, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useStorageApi, FOLDER } from './useStorageApi'
import type {
  Crumb, FileNode, FolderNode, StorageFile, StorageFileType, StorageFolder, StorageNode,
} from '../../types/storage'

export interface StorageBrowserOptions {
  productionId: MaybeRefOrGetter<string>
  rootFolderId?: MaybeRefOrGetter<string | null>
  /** Show only these storage types; null shows everything. */
  fileTypes?: MaybeRefOrGetter<StorageFileType[] | null>
}

/** One entry in the cursor-in-array navigation history. */
interface HistoryEntry {
  folderId: string | null
  crumbs: Crumb[]
}

/**
 * Browsing a production's storage tree: what's in the current folder, how you
 * got there, and how to get back.
 *
 * History is a cursor in an array — entries to the right of the cursor are the
 * "future" a back step left behind, and the next explicit navigation drops
 * them. The browser History API is deliberately not involved: storage lives
 * inside pages and dialogs that have their own route.
 *
 * The file explorer and the folder picker both run on this; the picker just
 * ignores `files` and the back/forward pair.
 *
 */
export function useStorageBrowser(
  { productionId, rootFolderId = null, fileTypes = null }: StorageBrowserOptions,
) {
  const api = useStorageApi()

  const folders = ref<FolderNode[]>([])
  const files   = ref<FileNode[]>([])
  const loading = ref(true)
  const failed  = ref(false)

  const folderId = ref<string | null>(toValue(rootFolderId) ?? null)
  const crumbs   = ref<Crumb[]>([])

  const history = ref<HistoryEntry[]>([{ folderId: folderId.value, crumbs: [] }])
  const cursor  = ref(0)

  const canGoBack    = computed(() => cursor.value > 0)
  const canGoForward = computed(() => cursor.value < history.value.length - 1)

  // Folders are never filtered — a filtered browse still has to be navigable.
  const visibleFiles = computed(() => {
    const types = toValue(fileTypes)
    return types ? files.value.filter(f => types.includes(f.type)) : files.value
  })

  const isEmpty = computed(() => !folders.value.length && !visibleFiles.value.length)

  async function load() {
    loading.value = true
    failed.value  = false
    const { ok, folders: f, files: x } = await api.list(toValue(productionId), folderId.value)
    loading.value = false
    if (!ok) { failed.value = true; return }
    folders.value = f
    files.value   = x
  }

  /** Move to a folder and record it, unless we're replaying history. */
  function go(id: string | null, trail: Crumb[], { record = true } = {}): Promise<void> {
    folderId.value = id
    crumbs.value   = trail
    if (record) {
      history.value = [...history.value.slice(0, cursor.value + 1), { folderId: id, crumbs: trail }]
      cursor.value  = history.value.length - 1
    }
    return load()
  }

  function replay(index: number): Promise<void> {
    cursor.value = index
    const entry = history.value[index]
    return go(entry.folderId, entry.crumbs, { record: false })
  }

  const openFolder = (folder: FolderNode) => go(folder.id, [...crumbs.value, { id: folder.id, name: folder.name }])

  /** -1 is the root; anything else is an index into `crumbs`. */
  const goToCrumb = (index: number) =>
    index === -1
      ? go(null, [])
      : go(crumbs.value[index].id, crumbs.value.slice(0, index + 1))

  const goBack    = (): void => { if (canGoBack.value)    void replay(cursor.value - 1) }
  const goForward = (): void => { if (canGoForward.value) void replay(cursor.value + 1) }

  /** Back to a root, forgetting where we'd been — for a picker reopening. */
  function reset(id: string | null = toValue(rootFolderId) ?? null): Promise<void> {
    folderId.value = id
    crumbs.value   = []
    history.value  = [{ folderId: id, crumbs: [] }]
    cursor.value   = 0
    return load()
  }

  // ── Local list edits, so a write doesn't cost a round trip ────────────────
  // Branched on `kind` rather than picking a ref up front: the two lists hold
  // different node types, so a shared `Ref<FolderNode[]> | Ref<FileNode[]>`
  // couldn't be written to without a cast.
  function patchNode(node: StorageNode, changes: Partial<StorageFile & StorageFolder>): void {
    if (node.kind === FOLDER) {
      const i = folders.value.findIndex(n => n.id === node.id)
      if (i !== -1) folders.value[i] = { ...folders.value[i], ...changes }
    } else {
      const i = files.value.findIndex(n => n.id === node.id)
      if (i !== -1) files.value[i] = { ...files.value[i], ...changes }
    }
  }

  function removeNode(node: StorageNode): void {
    if (node.kind === FOLDER) folders.value = folders.value.filter(n => n.id !== node.id)
    else                      files.value   = files.value.filter(n => n.id !== node.id)
  }

  if (rootFolderId) watch(() => toValue(rootFolderId), (id) => { void reset(id ?? null) })

  return {
    folders, files, visibleFiles, loading, failed, isEmpty,
    folderId, crumbs, canGoBack, canGoForward,
    load, refresh: load, openFolder, goToCrumb, goBack, goForward, reset,
    patchNode, removeNode,
  }
}

export type StorageBrowser = ReturnType<typeof useStorageBrowser>
