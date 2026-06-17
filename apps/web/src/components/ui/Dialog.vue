<script setup>
import { cn } from '../../lib/utils.js'

const props = defineProps({
  open:  { type: Boolean, required: true },
  class: { type: String, default: '' },
})

const emit = defineEmits(['close'])
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" @click="emit('close')" />
        <div :class="cn('relative z-10 bg-card border border-border rounded-lg shadow-xl w-full', props.class)">
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-enter-active,
.dialog-leave-active { transition: opacity 0.15s ease; }
.dialog-enter-from,
.dialog-leave-to     { opacity: 0; }
</style>
