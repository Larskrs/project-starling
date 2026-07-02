<script setup>
import Dialog        from './Dialog.vue'
import DialogContent from './DialogContent.vue'
import DialogHeader  from './DialogHeader.vue'
import DialogTitle   from './DialogTitle.vue'
import DialogFooter  from './DialogFooter.vue'
import Button        from './Button.vue'

defineProps({
  open:        { type: Boolean, required: true },
  title:       { type: String,  required: true },
  submitLabel: { type: String,  required: true },
  cancelLabel: { type: String,  required: true },
  loading:     { type: Boolean, default: false },
  disabled:    { type: Boolean, default: false },
  error:       { type: String,  default: '' },
})

defineEmits(['update:open', 'submit'])
</script>

<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)">
    <DialogContent class="max-w-sm p-6 flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
      </DialogHeader>

      <form class="flex flex-col gap-3" @submit.prevent="$emit('submit')">
        <slot />

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

        <DialogFooter class="pt-1">
          <slot name="footer">
            <Button type="button" variant="outline" @click="$emit('update:open', false)">
              {{ cancelLabel }}
            </Button>
            <Button type="submit" :disabled="disabled || loading">
              {{ loading ? '…' : submitLabel }}
            </Button>
          </slot>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
