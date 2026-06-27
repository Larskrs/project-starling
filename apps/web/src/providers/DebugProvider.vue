<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { provideDebugMenu } from './useDebugProvider'
import { useColorMode } from '../composables/useColorMode.js'
import { useLocale } from '../composables/useLocale.js'

const props = withDefaults(defineProps<{ triggerKey?: string }>(), {
  triggerKey: 'd',
})

const { visible, toggle } = provideDebugMenu()
const { toggle: toggleColorMode } = useColorMode()
const { toggleLocale } = useLocale()
const router = useRouter()
const route = useRoute()

const allRoutes = router.getRoutes().filter(r => !r.redirect && r.path !== '/:pathMatch(.*)*')
const selectedIndex = ref(-1)
const listRef = ref<HTMLElement | null>(null)

watch(visible, (v) => {
  if (!v) {
    selectedIndex.value = route.path ? allRoutes.findIndex(r => r.path === route.path) : -1
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

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        selectedIndex.value = (selectedIndex.value + 1) % allRoutes.length
        nextTick(scrollToSelected)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        selectedIndex.value = (selectedIndex.value - 1 + allRoutes.length) % allRoutes.length
        nextTick(scrollToSelected)
        return
      }
      if (e.key === 'Enter' && selectedIndex.value >= 0) {
        e.preventDefault()
        navigate(allRoutes[selectedIndex.value].path)
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

  if (e.key === 'l') {
    e.preventDefault()
    toggleLocale()
    return
  }

  if (e.key === props.triggerKey) {
    e.preventDefault()
    toggle()
  }
}

function navigate(path: string) {
  router.push(path)
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
          <span class="font-mono text-foreground">{{ route.path }}</span>
        </div>

        <!-- Routes section -->
        <div>
          <button
            class="flex items-center justify-between w-full px-3 py-2 hover:bg-muted/40 text-left text-sm"
          >
            <span>Routes</span>
            </button>
          <div class="border-t border-border max-h-56 overflow-y-auto" ref="listRef">
            <button
              v-for="(r, i) in allRoutes"
              :key="r.path"
              @click="navigate(r.path)"
              :class="[
                'flex w-full px-4 py-1.5 text-xs text-left font-mono transition-colors',
                i === selectedIndex
                  ? 'bg-primary text-primary-foreground'
                  : r.path === route.path
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
              ]"
            >
              {{ r.path }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
  <slot />
</template>
