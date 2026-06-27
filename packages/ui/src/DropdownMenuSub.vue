<script setup>
import { Icon } from '@iconify/vue'
import { DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuPortal, DropdownMenuSubContent } from 'radix-vue'

defineProps({
  label:    { type: String,  required: true },
  icon:     { type: String,  default: null  },
  disabled: { type: Boolean, default: false },
})
</script>

<template>
  <DropdownMenuSub>
    <DropdownMenuSubTrigger
      :disabled="disabled"
      class="relative flex w-full cursor-default select-none items-center gap-2.5 rounded-md mx-1 px-3 py-1.5 text-sm text-foreground outline-none transition-colors focus:bg-accent data-[state=open]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
    >
      <Icon v-if="icon" :icon="icon" class="size-4 shrink-0 text-muted-foreground" />
      <span class="flex-1 text-left">{{ label }}</span>
      <Icon icon="mdi:chevron-right" class="size-4 text-muted-foreground ml-auto" />
    </DropdownMenuSubTrigger>

    <DropdownMenuPortal>
      <DropdownMenuSubContent
        :side-offset="2"
        :align-offset="-4"
        class="z-[201] min-w-44 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl py-1 outline-none"
      >
        <slot />
      </DropdownMenuSubContent>
    </DropdownMenuPortal>
  </DropdownMenuSub>
</template>
