<script setup>
import Label from './Label.vue'
import { cn } from './utils'

/**
 * One setting: label in the left half, the control that changes it in the
 * right. `stacked` puts the control full-width below the label instead — for
 * lists, grids and pickers that can't work in half a row.
 *
 * `description` is for something the row needs to say about its current state
 * (a validation error, a setting overridden elsewhere), not for prose: the
 * label carries the meaning.
 */
const props = defineProps({
  label:       { type: String,  default: '' },
  description: { type: String,  default: '' },
  for:         { type: String,  default: undefined },
  stacked:     { type: Boolean, default: false },
  class:       { type: String,  default: '' },
})
</script>

<template>
  <div
    :class="cn(
      'flex flex-col gap-2 py-3',
      !stacked && 'sm:grid sm:grid-cols-2 sm:items-center sm:gap-6',
      props.class
    )"
  >
    <Label :for="props.for" class="text-foreground">
      <slot name="label">{{ label }}</slot>
    </Label>

    <div class="flex min-w-0 flex-col gap-1.5">
      <slot />
      <p v-if="description || $slots.description" class="text-xs leading-relaxed text-muted-foreground">
        <slot name="description">{{ description }}</slot>
      </p>
    </div>
  </div>
</template>
