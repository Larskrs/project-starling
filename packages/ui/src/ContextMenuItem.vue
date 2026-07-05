<script setup>
import { Icon } from '@iconify/vue'
import { ContextMenuItem } from 'radix-vue'

defineProps({
  icon:        { type: String,  default: null  },
  shortcut:    { type: String,  default: null  },
  disabled:    { type: Boolean, default: false },
  destructive: { type: Boolean, default: false },
})

defineEmits(['click'])
</script>

<template>
  <ContextMenuItem
    :disabled="disabled"
    class="relative flex w-full cursor-default select-none items-center gap-2.5 rounded-md mx-1 px-3 py-1.5 text-sm outline-none transition-colors focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
    :class="destructive ? 'text-destructive focus:text-destructive' : 'text-foreground'"
    @click="$emit('click')"
  >
    <slot name="icon">
      <Icon
        v-if="icon"
        :icon="icon"
        class="size-4 shrink-0"
        :class="destructive ? 'text-destructive' : 'text-muted-foreground'"
      />
    </slot>
    <span class="flex-1 text-left"><slot /></span>
    <slot name="shortcut">
      <span v-if="shortcut" class="ml-auto text-xs text-muted-foreground tracking-wide font-mono">
        {{ shortcut }}
      </span>
    </slot>
  </ContextMenuItem>
</template>
