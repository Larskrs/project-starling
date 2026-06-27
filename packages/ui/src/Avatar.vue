<script setup>
import { computed } from 'vue'
import { cn } from './utils.js'

const props = defineProps({
  src:   { type: String, default: null },
  alt:   { type: String, default: '' },
  size:  { type: Number, default: null },
  class: { type: String, default: '' },
})

const style = computed(() => props.size
  ? { width: props.size + 'px', height: props.size + 'px' }
  : {}
)
</script>

<template>
  <div
    :class="cn(
      'overflow-hidden bg-secondary flex items-center justify-center text-muted-foreground text-sm font-semibold select-none rounded-xl',
      size ? 'shrink-0' : 'w-full h-full',
      props.class,
    )"
    :style="style"
  >
    <img v-if="src" :src="src" :alt="alt" class="w-full h-full object-cover" />
    <slot v-else />
  </div>
</template>
