import { ref, computed, provide, inject } from 'vue'

const FILE_SELECTION_KEY = Symbol('file-selection')

export function provideFileSelection() {
  const selectedIds = ref(new Set())

  const selectedCount   = computed(() => selectedIds.value.size)
  const selectionActive = computed(() => selectedIds.value.size > 0)

  function isSelected(id) {
    return selectedIds.value.has(id)
  }

  function toggle(id) {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
  }

  function clearSelection() {
    selectedIds.value = new Set()
  }

  function selectAll(ids) {
    selectedIds.value = new Set(ids)
  }

  const ctx = { selectedIds, selectedCount, selectionActive, isSelected, toggle, clearSelection, selectAll }
  provide(FILE_SELECTION_KEY, ctx)
  return ctx
}

export function useFileSelection() {
  return inject(FILE_SELECTION_KEY, null)
}
