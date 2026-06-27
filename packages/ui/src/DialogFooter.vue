<script setup>
import { cn } from './utils.js'
const props = defineProps({ class: { type: String, default: '' } })
</script>

<template>
  <div :class="cn('flex justify-end gap-2', props.class)">
    <slot />
  </div>
</template>
