<script setup>
import { ref, watch, provide, onUnmounted, nextTick } from 'vue'

const props = defineProps({
  menu: { type: Object, required: true },
})

const panelEl = ref(null)
const pos     = ref({ x: 0, y: 0 })

async function reposition() {
  await nextTick()
  if (!panelEl.value) return

  const pw = panelEl.value.offsetWidth
  const ph = panelEl.value.offsetHeight
  const vw = window.innerWidth
  const vh = window.innerHeight

  let x, y
  if (props.menu.mousePos?.value) {
    x = props.menu.mousePos.value.x
    y = props.menu.mousePos.value.y
  } else {
    const trigger = props.menu.triggerEl.value
    if (!trigger) return
    const t = trigger.getBoundingClientRect()
    x = t.left
    y = t.bottom + 4
    if (x + pw > vw - 8) x = t.right - pw
  }

  if (x + pw > vw - 8) x = x - pw
  if (y + ph > vh - 8) y = y - ph - 4

  pos.value = { x: Math.max(8, x), y: Math.max(8, y) }
}

function onOutside(e) {
  const trigger = props.menu.triggerEl.value
  if (panelEl.value?.contains(e.target)) return
  if (trigger?.contains(e.target)) return
  props.menu.close()
}

function onEsc(e) {
  if (e.key === 'Escape') props.menu.close()
}

function onScroll() {
  props.menu.close()
}

watch(
  () => props.menu.isOpen.value,
  (open) => {
    if (open) {
      reposition()
      document.addEventListener('mousedown', onOutside)
      document.addEventListener('keydown', onEsc)
      document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    } else {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('keydown', onEsc)
      document.removeEventListener('scroll', onScroll, { capture: true })
    }
  },
)

onUnmounted(() => {
  document.removeEventListener('mousedown', onOutside)
  document.removeEventListener('keydown', onEsc)
  document.removeEventListener('scroll', onScroll, { capture: true })
})

provide('ctxClose', props.menu.close)
</script>

<template>
  <Teleport to="html">
    <Transition name="ctx">
      <div
        v-if="menu.isOpen.value"
        ref="panelEl"
        role="menu"
        class="fixed z-[200] min-w-44 bg-background rounded-lg border border-border bg-popover text-popover-foreground shadow-xl py-1 outline-none"
        :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
      >
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ctx-enter-active { transition: opacity 0.1s ease, transform 0.1s ease; }
.ctx-leave-active { transition: opacity 0.08s ease; }
.ctx-enter-from   { opacity: 0; transform: scale(0.96) translateY(-4px); }
.ctx-leave-to     { opacity: 0; }
</style>
