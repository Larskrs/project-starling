import { ref, computed, unref } from 'vue'
import { useRoute } from 'vue-router'
import { useApi } from './useApi.js'

/**
 * List + CRUD state for a production-scoped resource
 * (/api/company/{cslug}/production/{pslug}/{resourcePath}).
 *
 * Covers the whole manage-view lifecycle: load, create/edit dialog targets,
 * delete confirmation, and keeping `items` in sync after mutations.
 *
 * @param {string|import('vue').Ref|() => string} resourcePath  path after the production segment, e.g. 'timelines'
 * @param {{ loadError?: () => string }} options                translated message shown when loading fails
 */
export function useProductionCrud(resourcePath, { loadError } = {}) {
  const route      = useRoute()
  const { $fetch } = useApi()

  const base = computed(() => {
    const path = typeof resourcePath === 'function' ? resourcePath() : unref(resourcePath)
    return `/api/company/${route.params.cslug}/production/${route.params.pslug}/${path}`
  })

  const items   = ref([])
  const loading = ref(false)
  const error   = ref('')

  const createOpen   = ref(false)
  const editTarget   = ref(null)
  const deleteTarget = ref(null)
  const deleting     = ref(false)

  async function load() {
    loading.value = true
    error.value   = ''
    const { ok, data } = await $fetch(base.value, { silent: true })
    loading.value = false
    if (!ok) { error.value = loadError?.() ?? ''; return false }
    items.value = data ?? []
    return true
  }

  function onCreated(item) { items.value.push(item) }

  function onUpdated(item) {
    const i = items.value.findIndex(x => x.id === item.id)
    if (i !== -1) items.value[i] = item
    editTarget.value = null
  }

  async function confirmDelete() {
    deleting.value = true
    const { ok } = await $fetch(`${base.value}/${deleteTarget.value.id}`, { method: 'DELETE' })
    deleting.value = false
    if (ok) {
      items.value = items.value.filter(x => x.id !== deleteTarget.value.id)
      deleteTarget.value = null
    }
  }

  return {
    base, items, loading, error, load,
    createOpen, editTarget, deleteTarget, deleting,
    onCreated, onUpdated, confirmDelete,
  }
}
