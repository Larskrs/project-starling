<script setup lang="ts">
import { computed } from 'vue'
import { SliderRoot, SliderTrack, SliderRange, SliderThumb } from 'radix-vue'
import { cn } from './utils'

/**
 * A single-value slider.
 *
 * `v-model` is the plain number, not radix's array form — every use in this app
 * is one-handled, and unwrapping it at each call site is noise.
 */
const props = withDefaults(defineProps<{
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  /** Vertical sliders fill from the BOTTOM, the way a fader reads. */
  orientation?: 'horizontal' | 'vertical'
  /** Accessible name. Sliders are usually icon-labelled, so this is required. */
  label: string
  class?: string
}>(), {
  min: 0,
  max: 100,
  step: 1,
  disabled: false,
  orientation: 'horizontal',
  class: '',
})

const vertical = computed(() => props.orientation === 'vertical')

const model = defineModel<number>({ default: 0 })
</script>

<template>
  <SliderRoot
    :model-value="[model]"
    :min="props.min"
    :max="props.max"
    :step="props.step"
    :disabled="props.disabled"
    :orientation="props.orientation"
    :aria-label="props.label"
    :class="cn(
      'relative flex touch-none select-none items-center',
      vertical ? 'h-full w-4 flex-col justify-center' : 'w-full',
      props.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      props.class,
    )"
    @update:model-value="(v?: number[]) => { if (v?.[0] !== undefined) model = v[0] }"
  >
    <SliderTrack
      class="relative grow overflow-hidden rounded-full bg-input"
      :class="vertical ? 'h-full w-1' : 'h-1 w-full'"
    >
      <SliderRange class="absolute bg-primary" :class="vertical ? 'w-full' : 'h-full'" />
    </SliderTrack>
    <SliderThumb
      class="block size-3 rounded-full border border-primary bg-background shadow-sm transition-colors
             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1
             disabled:pointer-events-none"
    />
  </SliderRoot>
</template>
