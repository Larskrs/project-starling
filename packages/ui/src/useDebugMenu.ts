import { inject, provide, ref, type InjectionKey, type Ref } from 'vue'

export interface DebugMenuContext {
  visible: Ref<boolean>
  toggle: () => void
  open: () => void
  close: () => void
}

const DebugMenuKey: InjectionKey<DebugMenuContext> = Symbol('debug-menu')

export function provideDebugMenu(): DebugMenuContext {
  const visible = ref(false)
  const ctx: DebugMenuContext = {
    visible,
    toggle: () => { visible.value = !visible.value },
    open:   () => { visible.value = true },
    close:  () => { visible.value = false },
  }
  provide(DebugMenuKey, ctx)
  return ctx
}

export function useDebugMenu(): DebugMenuContext {
  const ctx = inject(DebugMenuKey)
  if (!ctx) throw new Error('useDebugMenu() needs a <DebugProvider> ancestor')
  return ctx
}
