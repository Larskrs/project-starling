<script setup>
import { Icon } from '@iconify/vue'
import { DropdownMenuLabel } from 'radix-vue'

defineProps({
  icon: { type: String, default: null },
})
</script>

<template>
  <DropdownMenuLabel class="flex items-center gap-2 px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider select-none">
    <Icon v-if="icon" :icon="icon" class="size-3.5 shrink-0" />
    <slot />
  </DropdownMenuLabel>
</template>
