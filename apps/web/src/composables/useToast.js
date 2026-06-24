import { ref, readonly } from 'vue'

const toasts = ref([])
let nextId = 0

export function useToast() {
  function add(message, type = 'info', duration = 4000) {
    const id = nextId++
    toasts.value = [...toasts.value, { id, message, type }]
    if (duration > 0) setTimeout(() => dismiss(id), duration)
    return id
  }

  function dismiss(id) {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }

  return {
    toasts: readonly(toasts),
    dismiss,
    error:   (message, duration) => add(message, 'error',   duration),
    success: (message, duration) => add(message, 'success', duration),
    info:    (message, duration) => add(message, 'info',    duration),
    warning: (message, duration) => add(message, 'warning', duration),
    auth:    (message, duration) => add(message, 'auth',    duration),
  }
}
