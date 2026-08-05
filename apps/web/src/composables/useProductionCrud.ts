import { ref, computed, inject, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import { useApi } from './useApi'
import type { Production } from '../types/api'

/** Anything this helper manages has to be addressable by id. */
export interface Identified { id: string }

/** The `production-data` provide from the Production layout view. */
export interface ProductionData {
  production: Production
}

export interface ProductionCrudOptions {
  /** Message shown when the list fails to load. */
  loadError?: () => string
  /** Item route base, when it differs from the collection URL. */
  itemBase?: string
}

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
 */
export function useProductionCrud<T extends Identified>(
  resourcePath: MaybeRefOrGetter<string>,
  { loadError, itemBase }: ProductionCrudOptions = {},
) {
  const productionData = inject<Ref<ProductionData> | null>('production-data', null)
  const { $fetch }     = useApi()
  const pid = computed(() => productionData?.value?.production?.id)

  const base = computed(() => {
    const path = toValue(resourcePath)
    return path.startsWith('/') ? path : `/api/production/${pid.value}/${path}`
  })

  const items   = ref([]) as Ref<T[]>
  const loading = ref(false)
  const error   = ref('')

  const createOpen   = ref(false)
  const editTarget   = ref<T | null>(null) as Ref<T | null>
  const deleteTarget = ref<T | null>(null) as Ref<T | null>
  const deleting     = ref(false)

  async function load() {
    loading.value = true
    error.value   = ''
    const { ok, data } = await $fetch<T[]>(base.value, { silent: true })
    loading.value = false
    if (!ok) { error.value = loadError?.() ?? ''; return false }
    items.value = data ?? []
    return true
  }

  function onCreated(item: T): void { items.value.push(item) }

  function onUpdated(item: T): void {
    const i = items.value.findIndex(x => x.id === item.id)
    if (i !== -1) items.value[i] = item
    editTarget.value = null
  }

  async function confirmDelete(): Promise<void> {
    const target = deleteTarget.value
    if (!target) return
    deleting.value = true
    const collection = itemBase ?? base.value.split('?')[0]
    const { ok } = await $fetch(`${collection}/${target.id}`, { method: 'DELETE' })
    deleting.value = false
    if (ok) {
      items.value = items.value.filter(x => x.id !== target.id)
      deleteTarget.value = null
    }
  }

  return {
    base, items, loading, error, load,
    createOpen, editTarget, deleteTarget, deleting,
    onCreated, onUpdated, confirmDelete,
  }
}
