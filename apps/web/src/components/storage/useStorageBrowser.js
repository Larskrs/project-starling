import { ref, computed, toValue, watch } from 'vue'
import { useStorageApi, FOLDER } from './useStorageApi.js'

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
 * @param {{
 *   productionId: string | (() => string) | import('vue').Ref<string>,
 *   rootFolderId?: string | (() => string) | import('vue').Ref<string>,
 *   fileTypes?: string[] | (() => string[]) | import('vue').Ref<string[]>,
 * }} options
 */
export function useStorageBrowser({ productionId, rootFolderId = null, fileTypes = null }) {
  const api = useStorageApi()

  const folders = ref([])
  const files   = ref([])
  const loading = ref(true)
  const failed  = ref(false)

  const folderId = ref(toValue(rootFolderId) ?? null)
  const crumbs   = ref([])                                    // [{ id, name }]

  const history = ref([{ folderId: folderId.value, crumbs: [] }])
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
  function go(id, trail, { record = true } = {}) {
    folderId.value = id
    crumbs.value   = trail
    if (record) {
      history.value = [...history.value.slice(0, cursor.value + 1), { folderId: id, crumbs: trail }]
      cursor.value  = history.value.length - 1
    }
    return load()
  }

  function replay(index) {
    cursor.value = index
    const entry = history.value[index]
    return go(entry.folderId, entry.crumbs, { record: false })
  }

  const openFolder = (folder) => go(folder.id, [...crumbs.value, { id: folder.id, name: folder.name }])

  /** -1 is the root; anything else is an index into `crumbs`. */
  const goToCrumb = (index) =>
    index === -1
      ? go(null, [])
      : go(crumbs.value[index].id, crumbs.value.slice(0, index + 1))

  const goBack    = () => canGoBack.value    && replay(cursor.value - 1)
  const goForward = () => canGoForward.value && replay(cursor.value + 1)

  /** Back to a root, forgetting where we'd been — for a picker reopening. */
  function reset(id = toValue(rootFolderId) ?? null) {
    folderId.value = id
    crumbs.value   = []
    history.value  = [{ folderId: id, crumbs: [] }]
    cursor.value   = 0
    return load()
  }

  // ── Local list edits, so a write doesn't cost a round trip ────────────────
  const listFor = (node) => (node.kind === FOLDER ? folders : files)

  function patchNode(node, changes) {
    const list = listFor(node)
    const i = list.value.findIndex(n => n.id === node.id)
    if (i !== -1) list.value[i] = { ...list.value[i], ...changes }
  }

  function removeNode(node) {
    const list = listFor(node)
    list.value = list.value.filter(n => n.id !== node.id)
  }

  if (rootFolderId) watch(() => toValue(rootFolderId), (id) => reset(id))

  return {
    folders, files, visibleFiles, loading, failed, isEmpty,
    folderId, crumbs, canGoBack, canGoForward,
    load, refresh: load, openFolder, goToCrumb, goBack, goForward, reset,
    patchNode, removeNode,
  }
}
