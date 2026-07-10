<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { provideDebugMenu } from './useDebugMenu'
import { useColorMode } from './useColorMode'

const props = withDefaults(defineProps<{
  /** Navigable paths shown in the menu. Empty hides the routes section. */
  routes?: string[]
  /** Current path; falls back to location.pathname for router-less apps. */
  current?: string | null
  /** How to go to a path; defaults to a full page load. */
  navigate?: ((path: string) => void) | null
  /** Wired to the "l" key; omit when the app has a single locale. */
  toggleLocale?: (() => void) | null
  /** Menu shortcut to a debug-settings page, when the app has one. */
  settingsPath?: string | null
  triggerKey?: string
}>(), {
  routes:       () => [],
  current:      null,
  navigate:     null,
  toggleLocale: null,
  settingsPath: null,
  triggerKey:   'd',
})

const { visible, toggle } = provideDebugMenu()
const { toggle: toggleColorMode } = useColorMode()

const currentPath   = computed(() => props.current ?? window.location.pathname)
const selectedIndex = ref(-1)
const listRef       = ref<HTMLElement | null>(null)

watch(visible, (v) => {
  if (!v) {
    selectedIndex.value = props.routes.indexOf(currentPath.value)
  }
})

function scrollToSelected() {
  if (!listRef.value || selectedIndex.value < 0) return
  const item = listRef.value.children[selectedIndex.value] as HTMLElement | undefined
  item?.scrollIntoView({ block: 'nearest' })
}

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function onKeydown(e: KeyboardEvent) {
  if (visible.value) {
    if (e.key === 'Escape') { e.preventDefault(); toggle(); return }

    if (e.key === 'ArrowDown' && props.routes.length) {
      e.preventDefault()
      selectedIndex.value = (selectedIndex.value + 1) % props.routes.length
      nextTick(scrollToSelected)
      return
    }
    if (e.key === 'ArrowUp' && props.routes.length) {
      e.preventDefault()
      selectedIndex.value = (selectedIndex.value - 1 + props.routes.length) % props.routes.length
      nextTick(scrollToSelected)
      return
    }
    if (e.key === 'Enter' && selectedIndex.value >= 0) {
      e.preventDefault()
      go(props.routes[selectedIndex.value])
      return
    }
  }

  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (isEditableTarget(e.target)) return

  if (e.key === 't') {
    e.preventDefault()
    toggleColorMode()
    return
  }

  if (e.key === 'l' && props.toggleLocale) {
    e.preventDefault()
    props.toggleLocale()
    return
  }

  if (e.key === 'r') {
    e.preventDefault()
    location.reload()
    return
  }

  if (e.key === props.triggerKey) {
    e.preventDefault()
    toggle()
  }
}

function go(path: string) {
  if (props.navigate) props.navigate(path)
  else window.location.href = path
  toggle()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-50 flex items-center justify-center"
      @click.self="toggle"
    >
      <div class="w-72 rounded-lg border border-border bg-background shadow-2xl overflow-hidden">
        <!-- Header -->
        <div class="flex items-center justify-between px-3 py-2 bg-muted/60 border-b border-border">
          <span class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Debug</span>
          <button @click="toggle" class="text-muted-foreground hover:text-foreground leading-none text-xs">✕</button>
        </div>

        <!-- Current route -->
        <div class="px-3 py-2 border-b border-border text-xs text-muted-foreground">
          <span class="font-mono text-foreground">{{ currentPath }}</span>
        </div>

        <!-- Routes section -->
        <div v-if="routes.length">
          <button
            class="flex items-center justify-between w-full px-3 py-2 hover:bg-muted/40 text-left text-sm"
          >
            <span>Routes</span>
          </button>
          <div class="border-t border-border max-h-56 overflow-y-auto" ref="listRef">
            <button
              v-for="(path, i) in routes"
              :key="path"
              @click="go(path)"
              :class="[
                'flex w-full px-4 py-1.5 text-xs text-left font-mono transition-colors',
                i === selectedIndex
                  ? 'bg-primary text-primary-foreground'
                  : path === currentPath
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
              ]"
            >
              {{ path }}
            </button>
          </div>
        </div>

        <!-- Debug settings shortcut -->
        <div v-if="settingsPath" class="border-t border-border">
          <button
            class="flex items-center justify-between w-full px-3 py-2 hover:bg-muted/40 text-left text-xs text-muted-foreground hover:text-foreground transition-colors"
            @click="go(settingsPath)"
          >
            <span>Debug settings</span>
            <span class="opacity-50">→</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
  <slot />
</template>
