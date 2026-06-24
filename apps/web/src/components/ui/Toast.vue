<script setup>
import { Icon } from '@iconify/vue'
import { useToast } from '../../composables/useToast.js'

const { toasts, dismiss } = useToast()

const ICONS = {
  error:   'mdi:alert-circle-outline',
  success: 'mdi:check-circle-outline',
  info:    'mdi:information-outline',
  warning: 'mdi:shield-alert-outline',
  auth:    'mdi:lock-outline',
}

const STYLES = {
  error:   'border-destructive/30 bg-card text-foreground [--icon-color:oklch(var(--destructive))]',
  success: 'border-green-500/30 bg-card text-foreground [--icon-color:oklch(0.62_0.19_145)]',
  info:    'border-border bg-card text-foreground [--icon-color:oklch(var(--muted-foreground))]',
  warning: 'border-yellow-500/30 bg-card text-foreground [--icon-color:oklch(0.78_0.17_85)]',
  auth:    'border-orange-500/30 bg-card text-foreground [--icon-color:oklch(0.72_0.15_55)]',
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 items-end pointer-events-none">
      <TransitionGroup
        enter-from-class="opacity-0 translate-y-2"
        enter-active-class="transition-all duration-200 ease-out"
        leave-to-class="opacity-0 translate-y-1 scale-95"
        leave-active-class="transition-all duration-150 ease-in"
      >
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg w-80 max-w-[calc(100vw-2.5rem)]"
          :class="STYLES[toast.type] ?? STYLES.info"
        >
          <Icon
            :icon="ICONS[toast.type] ?? ICONS.info"
            class="text-lg mt-px shrink-0"
            style="color: var(--icon-color)"
          />
          <p class="flex-1 text-sm leading-snug">{{ toast.message }}</p>
          <button
            class="shrink-0 -mr-1 -mt-0.5 p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
            @click="dismiss(toast.id)"
          >
            <Icon icon="mdi:close" class="text-sm" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
