import { ref, computed, inject, unref } from 'vue'
import { useApi } from './useApi.js'

/**
 * List + CRUD state for a production-scoped resource on the path-scoped API.
 *
 * `resourcePath` names the resource under the current production:
 *   'track-types'            → GET/POST  /api/production/{pid}/track-types
 *                              DELETE     /api/production/{pid}/track-types/{id}
 *   () => `sources?sid=${x}`  → GET/POST  /api/production/{pid}/sources?sid=x
 *                              DELETE     /api/production/{pid}/sources/{id}
 * A path starting with `/` is used verbatim as the collection URL (for the odd
 * resources like timelines that live outside the production prefix); pair it
 * with `itemBase` so deletes hit the right item route.
 *
 * Relies on the `production-data` provide from the Production layout view.
 *
 * @param {string|import('vue').Ref|() => string} resourcePath
 * @param {{ loadError?: () => string, itemBase?: string }} options
 */
export function useProductionCrud(resourcePath, { loadError, itemBase } = {}) {
  const productionData = inject('production-data')
  const { $fetch }     = useApi()
  const pid = computed(() => productionData?.value?.production?.id)

  const base = computed(() => {
    const path = typeof resourcePath === 'function' ? resourcePath() : unref(resourcePath)
    return path.startsWith('/') ? path : `/api/production/${pid.value}/${path}`
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
    const collection = itemBase ?? base.value.split('?')[0]
    const { ok } = await $fetch(`${collection}/${deleteTarget.value.id}`, { method: 'DELETE' })
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
