import { ref } from 'vue'

export function useContextMenu() {
  const isOpen    = ref(false)
  const triggerEl = ref(null)
  const mousePos  = ref(null)

  function open(event) {
    triggerEl.value = event.currentTarget ?? event.target
    mousePos.value  = event.clientX != null ? { x: event.clientX, y: event.clientY } : null
    isOpen.value    = true
  }

  function close() {
    isOpen.value    = false
    triggerEl.value = null
    mousePos.value  = null
  }

  function toggle(event) {
    if (isOpen.value) close()
    else open(event)
  }

  return { isOpen, triggerEl, mousePos, open, close, toggle }
}
