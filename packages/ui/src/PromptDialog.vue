<script setup>
import { ref, computed, watch } from 'vue'
import FormDialog from './FormDialog.vue'
import FormField  from './FormField.vue'
import Input      from './Input.vue'

/**
 * FormDialog for the case that keeps coming back: ask for one piece of text.
 * Renaming, naming a new folder, anything else where a whole form component
 * would be four fifths boilerplate.
 *
 * Emits `submit` with the trimmed value; the caller owns loading and error and
 * closes the dialog itself once the write lands.
 */
const props = defineProps({
  open:         { type: Boolean, required: true },
  title:        { type: String,  required: true },
  label:        { type: String,  default: '' },
  placeholder:  { type: String,  default: '' },
  submitLabel:  { type: String,  required: true },
  cancelLabel:  { type: String,  required: true },
  /** Prefilled on open — the current name when renaming. */
  initialValue: { type: String,  default: '' },
  maxlength:    { type: [String, Number], default: 128 },
  loading:      { type: Boolean, default: false },
  error:        { type: String,  default: '' },
})

const emit = defineEmits(['update:open', 'submit'])

const value = ref('')

// Refilled on every open so a cancelled edit doesn't leak into the next one.
watch(() => props.open, (isOpen) => { if (isOpen) value.value = props.initialValue }, { immediate: true })

const trimmed = computed(() => value.value.trim())
</script>

<template>
  <FormDialog
    :open="open"
    :title="title"
    :submit-label="submitLabel"
    :cancel-label="cancelLabel"
    :loading="loading"
    :disabled="!trimmed"
    :error="error"
    @update:open="emit('update:open', $event)"
    @submit="emit('submit', trimmed)"
  >
    <FormField :label="label">
      <Input v-model="value" :placeholder="placeholder" :maxlength="maxlength" autofocus required />
    </FormField>
  </FormDialog>
</template>
