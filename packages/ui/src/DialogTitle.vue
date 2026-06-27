<script setup>
import { DialogTitle } from 'radix-vue'
import { cn } from './utils.js'
const props = defineProps({ class: { type: String, default: '' } })
</script>

<template>
  <DialogTitle :class="cn('text-base font-semibold leading-none text-foreground', props.class)">
    <slot />
  </DialogTitle>
</template>
