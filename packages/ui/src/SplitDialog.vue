<script setup>
import Dialog        from './Dialog.vue'
import DialogContent from './DialogContent.vue'
import DialogHeader  from './DialogHeader.vue'
import DialogTitle   from './DialogTitle.vue'
import DialogFooter  from './DialogFooter.vue'
import Button        from './Button.vue'
import { cn } from './utils'

/**
 * The middle size between FormDialog and SettingsDialog: one form in two equal
 * columns — the general fields on the left, whatever is specific to this thing
 * on the right (its audio, its image, its cameras).
 *
 * No page rail and no section headings; the field labels carry the meaning.
 * Set `split` false when the right column has nothing to show, and the form
 * collapses to a single column rather than leaving a gap.
 */
const props = defineProps({
  open:        { type: Boolean, required: true },
  title:       { type: String,  required: true },
  description: { type: String,  default: '' },
  submitLabel: { type: String,  required: true },
  cancelLabel: { type: String,  required: true },
  loading:     { type: Boolean, default: false },
  disabled:    { type: Boolean, default: false },
  error:       { type: String,  default: '' },
  split:       { type: Boolean, default: true },
  class:       { type: String,  default: '' },
})

defineEmits(['update:open', 'submit'])
</script>

<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)">
    <DialogContent
      :class="cn(
        'flex max-h-[85vh] flex-col overflow-hidden p-0',
        split ? 'max-w-2xl' : 'max-w-md',
        props.class
      )"
    >
      <DialogHeader class="shrink-0 border-b border-border px-6 py-4">
        <DialogTitle>{{ title }}</DialogTitle>
        <p v-if="description" class="text-xs leading-relaxed text-muted-foreground">{{ description }}</p>
      </DialogHeader>

      <form class="flex min-h-0 flex-1 flex-col" @submit.prevent="$emit('submit')">
        <!-- One scroll area for both columns: two independent scrollbars in a
             dialog this size reads as a bug. -->
        <div
          class="grid min-h-0 flex-1 overflow-y-auto divide-y divide-border"
          :class="split ? 'sm:grid-cols-2 sm:divide-x sm:divide-y-0' : ''"
        >
          <div class="flex min-w-0 flex-col gap-4 px-6 py-5">
            <slot name="left" />
          </div>
          <div v-if="split" class="flex min-w-0 flex-col gap-4 px-6 py-5">
            <slot name="right" />
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-4 border-t border-border px-6 py-3">
          <p v-if="error" class="min-w-0 flex-1 text-sm text-destructive">{{ error }}</p>
          <DialogFooter class="ml-auto">
            <slot name="footer">
              <Button type="button" variant="outline" @click="$emit('update:open', false)">
                {{ cancelLabel }}
              </Button>
              <Button type="submit" :disabled="disabled || loading">
                {{ loading ? '…' : submitLabel }}
              </Button>
            </slot>
          </DialogFooter>
        </div>
      </form>
    </DialogContent>
  </Dialog>
</template>
