import { ref, computed, watch } from 'vue'
import { useApi } from './useApi.js'

/**
 * Create/edit dialog state shared by all entity form dialogs:
 * resets the form when the dialog opens, POSTs to `url()` in create mode,
 * PATCHes `url()/{entity.id}` in edit mode, and emits created/updated.
 *
 * @param {{
 *   open:          () => boolean,          dialog open prop
 *   entity:        () => object|null,      entity being edited; null → create mode
 *   emit:          Function,               component emit ('update:open' | 'created' | 'updated')
 *   url:           () => string,           collection endpoint
 *   fill:          (entity: object) => void,  populate form fields from the entity
 *   reset:         () => void,             reset form fields to defaults
 *   payload:       () => object,           request body built from form fields
 *   validate?:     () => boolean,          extra guard before submitting
 *   failedMessage: () => string,           fallback error message
 * }} options
 */
export function useEntityDialog({ open, entity, emit, url, fill, reset, payload, validate, failedMessage }) {
  const { $fetch } = useApi()

  const loading = ref(false)
  const error   = ref('')
  const isEdit  = computed(() => entity() !== null)

  watch(open, (isOpen) => {
    if (!isOpen) return
    error.value   = ''
    loading.value = false
    if (isEdit.value) fill(entity())
    else reset()
  })

  function close() { emit('update:open', false) }

  async function submit() {
    if (validate && !validate()) return
    loading.value = true
    error.value   = ''
    const target = isEdit.value ? `${url()}/${entity().id}` : url()
    const { ok, data, error: err } = await $fetch(target, {
      method: isEdit.value ? 'PATCH' : 'POST',
      json:   payload(),
      silent: true,
    })
    loading.value = false
    if (!ok) { error.value = err ?? failedMessage(); return }
    emit(isEdit.value ? 'updated' : 'created', data)
    close()
  }

  return { isEdit, loading, error, close, submit }
}
