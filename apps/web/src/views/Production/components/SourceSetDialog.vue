<script setup>
import { ref, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { FormDialog, FormField, Input } from '@starling/ui'
import { useEntityDialog } from '../../../composables/useEntityDialog.js'

const props = defineProps({
  open:      { type: Boolean, required: true },
  sourceSet: { type: Object,  default: null },  // null → create mode
})

const emit = defineEmits(['update:open', 'created', 'updated'])

const data = inject('production-data')
const { t } = useI18n()

const name = ref('')

const { isEdit, loading, error, submit } = useEntityDialog({
  open:   () => props.open,
  entity: () => props.sourceSet,
  emit,
  url: () => `/api/production/${data.value?.production?.id}/source-sets`,
  fill:  (s) => { name.value = s.name },
  reset: ()  => { name.value = '' },
  payload:       () => ({ name: name.value.trim() }),
  validate:      () => !!name.value.trim(),
  failedMessage: () => t('sourceSets.failedToSave'),
})
</script>

<template>
  <FormDialog
    :open="open"
    :title="isEdit ? $t('sourceSets.renameDialog.title') : $t('sourceSets.addDialog.title')"
    :submit-label="isEdit ? $t('sourceSets.save') : $t('sourceSets.create')"
    :cancel-label="$t('sourceSets.cancel')"
    :loading="loading"
    :disabled="!name.trim()"
    :error="error"
    @update:open="$emit('update:open', $event)"
    @submit="submit"
  >
    <FormField for="ss-name" :label="$t('sourceSets.name')">
      <Input
        id="ss-name"
        v-model="name"
        :placeholder="$t('sourceSets.namePlaceholder')"
        maxlength="128"
        autofocus
        required
      />
    </FormField>
  </FormDialog>
</template>
