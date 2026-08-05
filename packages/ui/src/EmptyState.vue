<script setup>
import { Icon } from '@iconify/vue'
import { cn } from './utils.js'

/**
 * "There is nothing here" — an icon, a line of text, and optionally something
 * to do about it. `bordered` draws the dashed placeholder box used where the
 * empty area is the content region itself rather than a row inside a card.
 */
const props = defineProps({
  icon:     { type: String,  default: '' },
  bordered: { type: Boolean, default: false },
  class:    { type: String,  default: '' },
})
</script>

<template>
  <div
    :class="cn(
      'flex flex-col items-center justify-center gap-2 py-12 text-center',
      bordered ? 'rounded-lg border border-dashed border-border' : '',
      props.class,
    )"
  >
    <slot name="icon">
      <Icon v-if="icon" :icon="icon" class="text-4xl text-muted-foreground/30" />
    </slot>
    <p class="text-sm text-muted-foreground"><slot /></p>
    <slot name="action" />
  </div>
</template>
