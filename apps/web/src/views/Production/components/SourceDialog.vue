<script setup>
import { ref, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { FormDialog, FormField, IconPicker, Input } from '@starling/ui'
import HuePicker from './HuePicker.vue'
import SourceBadge from './SourceBadge.vue'
import { useEntityDialog } from '../../../composables/useEntityDialog'
import { useIconPicker } from '../../../composables/useIconPicker'

const props = defineProps({
  open:   { type: Boolean, required: true },
  setId:  { type: String,  required: true },
  source: { type: Object,  default: null },   // null → create mode
})

const emit = defineEmits(['update:open', 'created', 'updated'])

const { t } = useI18n()
const data = inject('production-data')
const iconPicker = useIconPicker()

const name      = ref('')
const shortName = ref('')
const hue       = ref(200)
const icon      = ref(null)

const { isEdit, loading, error, submit } = useEntityDialog({
  open:   () => props.open,
  entity: () => props.source,
  emit,
  url: () => `/api/production/${data.value?.production?.id}/sources?sid=${props.setId}`,
  fill: (s) => {
    name.value      = s.name
    shortName.value = s.shortName
    hue.value       = s.hue
    icon.value      = s.icon ?? null
  },
  reset: () => {
    name.value = ''; shortName.value = ''; hue.value = 200; icon.value = null
  },
  payload: () => ({
    name:      name.value.trim(),
    shortName: shortName.value.trim(),
    hue:       hue.value,
    icon:      icon.value,
  }),
  validate:      () => !!name.value.trim() && !!shortName.value.trim(),
  failedMessage: () => t('sources.failedToSave'),
})
</script>

<template>
  <FormDialog
    :open="open"
    :title="isEdit ? $t('sources.editDialog.title') : $t('sources.addDialog.title')"
    :submit-label="isEdit ? $t('sources.save') : $t('sources.create')"
    :cancel-label="$t('sources.cancel')"
    :loading="loading"
    :disabled="!name.trim() || !shortName.trim()"
    :error="error"
    @update:open="$emit('update:open', $event)"
    @submit="submit"
  >
    <div class="grid grid-cols-4 gap-1">
      <FormField for="src-short" :label="$t('sources.shortName')">
        <Input
          id="src-short"
          v-model="shortName"
          :placeholder="$t('sources.shortNamePlaceholder')"
          maxlength="16"
          required
        />
      </FormField>

      <FormField for="src-name" :label="$t('sources.name')" class="col-span-3">
        <Input
          id="src-name"
          v-model="name"
          :placeholder="$t('sources.namePlaceholder')"
          maxlength="128"
          autofocus
          required
        />
      </FormField>
    </div>

    <FormField :label="$t('sources.hue')">
      <HuePicker v-model="hue" />
    </FormField>

    <FormField :label="$t('sources.icon')">
      <IconPicker v-model="icon" v-bind="iconPicker" :hue="hue" allow-none />
    </FormField>

    <!-- Preview -->
    <div class="flex items-center gap-2 text-sm text-muted-foreground">
      <SourceBadge :short-name="shortName" :hue="hue" :icon="icon" />
      <span>{{ name || $t('sources.namePlaceholder') }}</span>
    </div>
  </FormDialog>
</template>
