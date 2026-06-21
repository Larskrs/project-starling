<script setup>
import { ref, nextTick, onUnmounted } from 'vue'
import { Icon } from '@iconify/vue'
import ContextMenuItemBase from './ContextMenuItemBase.vue'

defineProps({
  label:    { type: String, required: true },
  icon:     { type: String, default: null },
  disabled: { type: Boolean, default: false },
})

const isOpen     = ref(false)
const triggerEl  = ref(null)
const subEl      = ref(null)
const openToLeft = ref(false)
const subTop     = ref(0)

function onOutside(e) {
  if (triggerEl.value?.contains(e.target)) return
  closeSub()
}

async function openSub() {
  isOpen.value = true
  await nextTick()
  if (!triggerEl.value || !subEl.value) return

  const tr = triggerEl.value.getBoundingClientRect()
  const sw = subEl.value.offsetWidth
  const sh = subEl.value.offsetHeight

  openToLeft.value = tr.right + sw > window.innerWidth - 8

  const rawTop = tr.top
  subTop.value = rawTop + sh > window.innerHeight - 8 ? window.innerHeight - sh - 8 - tr.top : 0

  document.addEventListener('mousedown', onOutside, { capture: true })
}

function closeSub() {
  if (!isOpen.value) return
  isOpen.value = false
  document.removeEventListener('mousedown', onOutside, { capture: true })
}

function toggleSub() {
  if (isOpen.value) closeSub()
  else openSub()
}

onUnmounted(() => {
  document.removeEventListener('mousedown', onOutside, { capture: true })
})
</script>

<template>
  <div ref="triggerEl" class="relative">
    <!-- Trigger row -->
    <ContextMenuItemBase
      :icon="icon"
      :disabled="disabled"
      :active="isOpen"
      aria-haspopup="menu"
      :aria-expanded="isOpen"
      @click.stop="!disabled && toggleSub()"
    >
      {{ label }}
      <template #trailing>
        <Icon
          icon="mdi:chevron-right"
          class="size-4 text-muted-foreground ml-auto transition-transform duration-150"
          :class="{ 'rotate-90': isOpen }"
        />
      </template>
    </ContextMenuItemBase>

    <!-- Submenu panel -->
    <Transition name="ctx-sub">
      <div
        v-if="isOpen && !disabled"
        ref="subEl"
        role="menu"
        class="absolute min-w-44 rounded-lg border border-border bg-popover text-popover-foreground shadow-xl py-1 z-10"
        :class="openToLeft ? 'right-full mr-1' : 'left-full ml-1'"
        :style="{ top: subTop + 'px' }"
      >
        <slot />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.ctx-sub-enter-active { transition: opacity 0.05s ease, transform 0.5s cubic-bezier(.11,.99,0,1); }
.ctx-sub-leave-active { transition: opacity 0.25s ease; }
.ctx-sub-enter-from   { opacity: 0; transform: translateX(-12px); }
.ctx-sub-leave-to     { opacity: 0; }
</style>
