<script setup>
import { Icon }      from '@iconify/vue'
import { RouterLink } from 'vue-router'

const props = defineProps({
  to: { type: [String, Object], default: null },
})
</script>

<template>
  <li>
    <component
      :is="to ? RouterLink : 'div'"
      :to="to || undefined"
      class="flex items-center gap-3 px-4 py-3 transition-colors"
      :class="to ? 'hover:bg-hover group' : ''"
    >
      <slot />
      <Icon
        v-if="to"
        icon="mdi:chevron-right"
        class="ml-auto shrink-0 size-6 text-muted-foreground/25 transition-all duration-150
               group-hover:text-muted-foreground/90 group-hover:translate-x-0.5
               group-active:-translate-x-0.5 group-active:text-muted-foreground/80"
      />
    </component>
  </li>
</template>
