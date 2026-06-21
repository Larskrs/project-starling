<script setup>
import Dialog from './Dialog.vue'
import Button from './Button.vue'

defineProps({
  open:         { type: Boolean, required: true },
  title:        { type: String,  required: true },
  confirmLabel: { type: String,  default: 'Confirm' },
  cancelLabel:  { type: String,  default: 'Cancel' },
  loading:      { type: Boolean, default: false },
  destructive:  { type: Boolean, default: false },
})

defineEmits(['confirm', 'cancel'])
</script>

<template>
  <Dialog :open="open" class="max-w-sm" @close="$emit('cancel')">
    <div class="p-6 flex flex-col gap-4">
      <h3 class="text-base font-semibold text-foreground">{{ title }}</h3>

      <p class="text-sm text-muted-foreground leading-relaxed">
        <slot />
      </p>

      <div class="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" :disabled="loading" @click="$emit('cancel')">
          {{ cancelLabel }}
        </Button>
        <Button
          type="button"
          :variant="destructive ? 'destructive' : 'default'"
          :disabled="loading"
          @click="$emit('confirm')"
        >
          {{ loading ? 'Deleting…' : confirmLabel }}
        </Button>
      </div>
    </div>
  </Dialog>
</template>
