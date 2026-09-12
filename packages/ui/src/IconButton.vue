<script setup>
import { Icon } from '@iconify/vue'
import { cn } from './utils'

/**
 * A compact icon-only button.
 *
 * `title` doubles as the ACCESSIBLE NAME, not just a tooltip. A title attribute
 * alone is not a reliable name: screen readers treat it inconsistently, and it
 * is invisible to anyone using a keyboard or a touch screen, so a button whose
 * only content is an <Icon> ends up announced as nothing at all. Mirroring it
 * into aria-label costs nothing and means every call site that already passes a
 * title gets a named control for free.
 *
 * The icon itself is hidden from assistive tech — it carries no information the
 * label does not already give, and announcing both is just noise.
 */
const props = defineProps({
  icon:        { type: String,  default: null },
  title:       { type: String,  default: '' },
  destructive: { type: Boolean, default: false },
  class:       { type: String,  default: '' },
  /** Override the accessible name when it should differ from the tooltip. */
  ariaLabel:   { type: String,  default: '' },
})
</script>

<template>
  <button
    type="button"
    :title="title || undefined"
    :aria-label="ariaLabel || title || undefined"
    :class="cn(
      'p-1.5 rounded-md text-muted-foreground hover:bg-accent transition-colors shrink-0',
      // Matches Button.vue, so keyboard focus is visible on every control in
      // the system rather than only the ones with a text label.
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      'focus-visible:ring-offset-2 ring-offset-background',
      'disabled:opacity-30 disabled:pointer-events-none',
      destructive ? 'hover:text-destructive' : 'hover:text-foreground',
      props.class,
    )"
  >
    <slot>
      <Icon v-if="icon" :icon="icon" class="size-3.5" aria-hidden="true" />
    </slot>
  </button>
</template>
