<script setup>
import { provide, ref, watch } from 'vue'
import Dialog        from './Dialog.vue'
import DialogContent from './DialogContent.vue'
import DialogHeader  from './DialogHeader.vue'
import DialogTitle   from './DialogTitle.vue'
import DialogFooter  from './DialogFooter.vue'
import DialogSidebar from './DialogSidebar.vue'
import Button        from './Button.vue'
import { cn } from './utils'

/**
 * A form dialog split into pages: a page rail on the left, the active page's
 * settings on the right, one shared footer. Fill it with SettingsPage /
 * SettingsRow.
 *
 * `pages` may change while the dialog is open (a page that only applies to
 * some selections); if the active page disappears the first one takes over.
 */
const props = defineProps({
  open:        { type: Boolean, required: true },
  title:       { type: String,  required: true },
  description: { type: String,  default: '' },
  pages:       { type: Array,   required: true },  // [{ id, label, icon?, invalid? }]
  submitLabel: { type: String,  required: true },
  cancelLabel: { type: String,  required: true },
  loading:     { type: Boolean, default: false },
  disabled:    { type: Boolean, default: false },
  error:       { type: String,  default: '' },
  class:       { type: String,  default: '' },
})

defineEmits(['update:open', 'submit'])

// Optional: bind `v-model:page` to drive the rail from outside, or leave it
// alone and the dialog keeps the page on its own.
const page = defineModel('page', { type: String, default: '' })

function fallback() {
  if (!props.pages.some(p => p.id === page.value)) page.value = props.pages[0]?.id ?? ''
}

// Reopening always starts at the first page — the dialog is a fresh form.
watch(() => props.open, (isOpen) => { if (isOpen) page.value = props.pages[0]?.id ?? '' })
watch(() => props.pages, fallback, { deep: true })
fallback()

provide('settings-dialog-page', page)

// The page rail comes before the fields in the DOM, so the dialog would open
// with a page button focused. Hand focus to the field that asked for it — only
// a visible one, since inactive pages stay mounted.
const contentEl = ref(null)

function onOpenAutoFocus(event) {
  const field = Array.from(contentEl.value?.querySelectorAll('[autofocus]') ?? [])
    .find(el => el.offsetParent !== null)
  if (!field) return
  event.preventDefault()
  field.focus()
}
</script>

<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)">
    <DialogContent
      :class="cn('flex max-h-[85vh] max-w-3xl flex-col overflow-hidden p-0', props.class)"
      @open-auto-focus="onOpenAutoFocus"
    >
      <DialogHeader class="shrink-0 border-b border-border px-6 py-4">
        <DialogTitle>{{ title }}</DialogTitle>
        <p v-if="description" class="text-xs leading-relaxed text-muted-foreground">{{ description }}</p>
      </DialogHeader>

      <form class="flex min-h-0 flex-1 flex-col" @submit.prevent="$emit('submit')">
        <!-- A floor on the height so switching to a short page doesn't make the
             dialog jump, capped so it can still shrink on a short viewport. -->
        <div class="flex min-h-0 flex-1 flex-col sm:min-h-[min(20rem,50vh)] sm:flex-row">
          <DialogSidebar
            v-model="page"
            :items="pages"
            class="border-b border-border sm:border-b-0 sm:border-r"
          />

          <div ref="contentEl" class="flex min-w-0 flex-1 flex-col overflow-y-auto px-6 py-3">
            <slot :page="page" />
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
