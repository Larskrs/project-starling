<script setup>
import { cn } from '../../lib/utils.js'
const props = defineProps({ class: { type: String, default: '' } })
</script>

<template>
  <label :class="cn('text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70', props.class)" v-bind="$attrs">
    <slot />
  </label>
</template>
