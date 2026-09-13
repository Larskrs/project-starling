import { ref, readonly } from 'vue'

export type ToastType = 'info' | 'success' | 'warning' | 'error' | 'auth'

/** A single button on a toast ("Undo"). Pressing it also dismisses the toast. */
export interface ToastAction {
  label: string
  run: () => void
}

export interface Toast {
  id: number
  message: string
  type: ToastType
  action?: ToastAction
}

export interface ToastOptions {
  type?: ToastType
  /** ms before it dismisses itself; 0 keeps it until closed. */
  duration?: number
  action?: ToastAction
}

const toasts = ref<Toast[]>([])
let nextId = 0

/** Module-level queue: every caller pushes into the same list of toasts. */
export function useToast() {
  function add(message: string, type: ToastType = 'info', duration = 4000, action?: ToastAction): number {
    const id = nextId++
    toasts.value = [...toasts.value, { id, message, type, ...(action ? { action } : {}) }]
    if (duration > 0) setTimeout(() => dismiss(id), duration)
    return id
  }

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }

  return {
    toasts: readonly(toasts),
    dismiss,
    /** The general form, for a toast that carries an action. */
    show:    (message: string, { type = 'info', duration, action }: ToastOptions = {}) => add(message, type, duration, action),
    error:   (message: string, duration?: number) => add(message, 'error',   duration),
    success: (message: string, duration?: number) => add(message, 'success', duration),
    info:    (message: string, duration?: number) => add(message, 'info',    duration),
    warning: (message: string, duration?: number) => add(message, 'warning', duration),
    auth:    (message: string, duration?: number) => add(message, 'auth',    duration),
  }
}
