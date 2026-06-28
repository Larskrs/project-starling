<script setup>
import { computed } from 'vue'
import Image from './Image.vue'
import { cn } from './utils.js'

const props = defineProps({
  id:      { type: String,  default: null },
  alt:     { type: String,  default: '' },
  quality: { type: Number,  default: 34 },
  size:    { type: Number,  default: null },
  class:   { type: String,  default: '' },
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
    <Image v-if="id" :id="id" :alt="alt" :quality="quality" class="w-full h-full object-cover" />
    <slot v-else />
  </div>
</template>
