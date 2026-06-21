<script setup>
import { Icon } from '@iconify/vue'

defineProps({
  icon:        { type: String, default: null },
  disabled:    { type: Boolean, default: false },
  destructive: { type: Boolean, default: false },
  active:      { type: Boolean, default: false },
})
</script>

<template>
  <button
    type="button"
    role="menuitem"
    class="w-full px-1 focus-visible:outline-none"
  >
    <div
      class="flex w-full items-center gap-2.5 px-3 py-1.5 text-sm rounded-md transition-colors select-none"
      :class="[
        disabled
          ? 'opacity-40 cursor-not-allowed pointer-events-none'
          : active
            ? 'bg-accent cursor-default'
            : 'hover:bg-accent cursor-default',
        destructive ? 'text-destructive' : 'text-foreground',
      ]"
    >
      <slot name="icon">
        <Icon
          v-if="icon"
          :icon="icon"
          class="size-4 shrink-0"
          :class="destructive ? 'text-destructive' : 'text-muted-foreground'"
        />
      </slot>

      <span class="flex-1 text-left">
        <slot />
      </span>

      <slot name="trailing" />
    </div>
  </button>
</template>
