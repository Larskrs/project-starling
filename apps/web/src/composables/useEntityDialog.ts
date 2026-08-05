import { ref, computed, watch } from 'vue'
import { useApi } from './useApi'

/** Anything this dialog can edit is addressable by id. */
export interface Identified { id: string }

export interface EntityDialogOptions<T extends Identified> {
  /** The dialog's `open` prop. */
  open: () => boolean
  /** Entity being edited; null puts the dialog in create mode. */
  entity: () => T | null
  emit: (event: 'update:open' | 'created' | 'updated', payload?: unknown) => void
  /** Collection endpoint (the POST target). */
  url: () => string
  /** PATCH target in edit mode; defaults to `url()` (query stripped) + `/{id}`. */
  itemUrl?: (entity: T) => string
  /** Populate the form fields from the entity. */
  fill: (entity: T) => void
  /** Reset the form fields to their defaults. */
  reset: () => void
  /** Request body built from the form fields. */
  payload: () => Record<string, unknown>
  /** Extra guard before submitting. */
  validate?: () => boolean
  /** Fallback error message. */
  failedMessage: () => string
  /**
   * Follow-up work that needs the saved entity — e.g. uploading an image to a
   * row that only just got an id. Runs before created/updated is emitted;
   * return a replacement entity to emit instead of the saved one.
   */
  afterSubmit?: (saved: T, ctx: { isEdit: boolean }) => Promise<T | void>
}

/**
 * Create/edit dialog state shared by all entity form dialogs:
 * resets the form when the dialog opens, POSTs to `url()` in create mode,
 * PATCHes `url()/{entity.id}` in edit mode, and emits created/updated.
 *
 * @param {{
 *   open:          () => boolean,          dialog open prop
 *   entity:        () => object|null,      entity being edited; null → create mode
 *   emit:          Function,               component emit ('update:open' | 'created' | 'updated')
 *   url:           () => string,           collection endpoint (POST target)
 *   itemUrl?:      (entity) => string,     PATCH target in edit mode; defaults to `url()` (query stripped) + `/{id}`
 *   fill:          (entity: object) => void,  populate form fields from the entity
 *   reset:         () => void,             reset form fields to defaults
 *   payload:       () => object,           request body built from form fields
 *   validate?:     () => boolean,          extra guard before submitting
 *   failedMessage: () => string,           fallback error message
 *   afterSubmit?:  (saved, { isEdit }) => Promise<object|void>,
 *                                          follow-up work that needs the saved
 *                                          entity — e.g. uploading an image to
 *                                          a row that only just got an id.
 *                                          Runs before created/updated is
 *                                          emitted; return a replacement entity
 *                                          to emit instead of the saved one.
 * }} options
 */
export function useEntityDialog<T extends Identified>({
  open, entity, emit, url, itemUrl, fill, reset, payload, validate, failedMessage, afterSubmit,
}: EntityDialogOptions<T>) {
  const { $fetch } = useApi()

  const loading = ref(false)
  const error   = ref('')
  const isEdit  = computed(() => entity() !== null)

  watch(open, (isOpen: boolean) => {
    if (!isOpen) return
    error.value   = ''
    loading.value = false
    if (isEdit.value) fill(entity() as T)
    else reset()
  })

  function close(): void { emit('update:open', false) }

  async function submit(): Promise<void> {
    if (validate && !validate()) return
    loading.value = true
    error.value   = ''
    // Collection URLs may carry a scope query (`…/sources?sid=…`); item
    // mutations address the entity by id alone. Resources whose item route
    // differs from the collection (timelines) pass an explicit `itemUrl`.
    const current = entity()
    const target = isEdit.value && current
      ? (itemUrl ? itemUrl(current) : `${url().split('?')[0]}/${current.id}`)
      : url()
    const { ok, data, error: err } = await $fetch<T>(target, {
      method: isEdit.value ? 'PATCH' : 'POST',
      json:   payload(),
      silent: true,
    })
    if (!ok) { loading.value = false; error.value = err ?? failedMessage(); return }

    // Stays in the loading state across the follow-up so the dialog can't be
    // resubmitted while, say, an image upload is still in flight.
    const finished = afterSubmit ? await afterSubmit(data, { isEdit: isEdit.value }) : null
    loading.value = false

    emit(isEdit.value ? 'updated' : 'created', finished ?? data)
    close()
  }

  return { isEdit, loading, error, close, submit }
}
