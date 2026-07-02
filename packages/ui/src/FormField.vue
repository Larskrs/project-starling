<script setup>
import Label from './Label.vue'
import { cn } from './utils.js'

const props = defineProps({
  label: { type: String, default: '' },
  for:   { type: String, default: undefined },
  class: { type: String, default: '' },
})
</script>

<template>
  <div :class="cn('flex flex-col gap-1.5', props.class)">
    <Label :for="props.for">
      <slot name="label">{{ label }}</slot>
    </Label>
    <slot />
  </div>
</template>
