<script setup>
import { SwitchRoot, SwitchThumb } from 'radix-vue'
import { cn } from './utils'

const props = defineProps({
  disabled: { type: Boolean, default: false },
  class:    { type: String,  default: '' },
})

const model = defineModel({ type: Boolean, default: false })
</script>

<template>
  <SwitchRoot
    v-model:checked="model"
    :disabled="disabled"
    :class="cn(
      'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full px-0.5 transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
      'disabled:cursor-not-allowed disabled:opacity-50',
      model ? 'bg-primary' : 'bg-input',
      props.class
    )"
  >
    <SwitchThumb
      class="pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform"
      :class="model ? 'translate-x-4' : 'translate-x-0'"
    />
  </SwitchRoot>
</template>
