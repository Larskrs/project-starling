<script setup>
import { ConfirmDialog, ListSection } from '@starling/ui'
import ManagePageHeader from './ManagePageHeader.vue'

/**
 * The shape every production management page has: a heading with one primary
 * action, a list card below it, and a delete confirmation wired to whichever
 * row the user reached for.
 *
 * Pairs with `useProductionCrud` — bind its refs straight through, put the row
 * markup in the default slot and the create/edit dialogs in `#dialogs`. What's
 * left in each view is only what makes that resource different.
 */
defineProps({
  title:        { type: String,  required: true },
  description:  { type: String,  default: '' },
  /** Heading on the list card, when it should differ from the page title. */
  listTitle:    { type: String,  default: '' },

  loading:      { type: Boolean, default: false },
  error:        { type: String,  default: '' },
  count:        { type: Number,  default: 0 },
  skeletonRows: { type: Number,  default: 3 },

  /** Row awaiting delete confirmation; null keeps the dialog closed. */
  deleteTarget: { type: Object,  default: null },
  deleting:     { type: Boolean, default: false },
  deleteTitle:  { type: String,  default: '' },
  deleteLabel:  { type: String,  default: '' },
  cancelLabel:  { type: String,  default: '' },
  /** Already interpolated by the caller — it knows the row's name. */
  deleteMessage:{ type: String,  default: '' },
})

defineEmits(['confirm-delete', 'cancel-delete'])
</script>

<template>
  <div class="max-w-3xl mx-auto px-6 py-8 flex flex-col gap-5">

    <ManagePageHeader>
      <template #back><slot name="back" /></template>
      <template #title><slot name="title">{{ title }}</slot></template>
      <template #description><slot name="description">{{ description }}</slot></template>
      <template #action><slot name="action" /></template>
    </ManagePageHeader>

    <ListSection
      :title="listTitle || title"
      :loading="loading"
      :error="error"
      :count="count"
      :skeleton-rows="skeletonRows"
    >
      <!-- Forwarded only when given, so ListSection keeps its own fallbacks. -->
      <template v-if="$slots.skeleton" #skeleton><slot name="skeleton" /></template>
      <template v-if="$slots.empty" #empty><slot name="empty" /></template>
      <slot />
    </ListSection>

    <slot name="dialogs" />

    <ConfirmDialog
      :open="deleteTarget !== null"
      :title="deleteTitle"
      :confirm-label="deleteLabel"
      :cancel-label="cancelLabel"
      :loading="deleting"
      destructive
      @confirm="$emit('confirm-delete')"
      @cancel="$emit('cancel-delete')"
    >
      {{ deleteMessage }}
    </ConfirmDialog>

  </div>
</template>
