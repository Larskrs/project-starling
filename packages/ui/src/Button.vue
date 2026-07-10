<script setup>
import { computed } from 'vue'
import { cn } from './utils.js'

const props = defineProps({
  variant: { type: String, default: 'default' },
  size:    { type: String, default: 'default' },
  class:   { type: String, default: '' },
  // Render as another element, e.g. as="a" for link-styled buttons.
  as:      { type: String, default: 'button' },
})

const base = 'inline-flex gap-1.5 items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ring-offset-background'

const variants = {
  default:     'bg-primary text-primary-foreground hover:bg-primary/90',
  outline:     'border border-input bg-background hover:bg-hover hover:border-hover hover:text-accent-foreground',
  ghost:       'hover:bg-accent hover:text-accent-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
}

const sizes = {
  default: 'h-10 px-4 py-2',
  sm:      'h-9 px-3',
  lg:      'h-11 px-8',
  icon:    'h-10 w-10',
  xs:      'h-7 px-2.5',
}

const cls = computed(() => cn(base, variants[props.variant] ?? variants.default, sizes[props.size] ?? sizes.default, props.class))
</script>

<template>
  <component :is="as" :class="cls" v-bind="$attrs">
    <slot />
  </component>
</template>
