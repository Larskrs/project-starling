<script setup>
import { cn } from './utils.js'
const props = defineProps({ class: { type: String, default: '' } })
</script>

<template>
  <div :class="cn('flex flex-col gap-1 pr-8', props.class)">
    <slot />
  </div>
</template>
