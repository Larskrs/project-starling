import { ref } from 'vue'

export function useContextMenu() {
  const isOpen    = ref(false)
  const triggerEl = ref(null)

  function open(event) {
    triggerEl.value = event.currentTarget ?? event.target
    isOpen.value    = true
  }

  function close() {
    isOpen.value    = false
    triggerEl.value = null
  }

  function toggle(event) {
    if (isOpen.value) close()
    else open(event)
  }

  return { isOpen, triggerEl, open, close, toggle }
}
