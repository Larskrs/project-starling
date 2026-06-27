<script setup>
import { Icon } from '@iconify/vue'

defineProps({
  items: { type: Array, required: true },
})
</script>

<template>
  <nav class="flex items-center gap-1 flex-wrap">
    <template v-for="(item, i) in items" :key="i">
      <slot :item="item" :index="i" :is-first="i === 0" :is-last="i === items.length - 1" />
      <template v-if="i < items.length - 1">
        <slot name="separator">
          <Icon icon="mdi:chevron-right" class="text-muted-foreground/40 text-xs shrink-0" />
        </slot>
      </template>
    </template>
  </nav>
</template>
