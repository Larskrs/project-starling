<script setup>
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { FormDialog, FormField, Input, SelectMenu, SwitchTab } from '@starling/ui'
import { useEntityDialog } from '../../../composables/useEntityDialog.js'

const props = defineProps({
  open:       { type: Boolean, required: true },
  trackType:  { type: Object,  default: null },
  sourceSets: { type: Array,   default: () => [] },
})

const emit = defineEmits(['update:open', 'created', 'updated'])

const route = useRoute()
const { t } = useI18n()

const name        = ref('')
const color       = ref('#6366f1')
const mode        = ref('clip')
const sourceSetId = ref(null)

const modeOptions = computed(() => [
  { value: 'clip',  label: t('trackTypes.modeClip') },
  { value: 'event', label: t('trackTypes.modeEvent') },
])
const sourceSetOptions = computed(() =>
  props.sourceSets.map(s => ({ value: s.id, label: s.name }))
)

const { isEdit, loading, error, submit } = useEntityDialog({
  open:   () => props.open,
  entity: () => props.trackType,
  emit,
  url: () => `/api/company/${route.params.cslug}/production/${route.params.pslug}/track-types`,
  fill: (tt) => {
    name.value        = tt.name
    color.value       = tt.color ?? '#6366f1'
    mode.value        = tt.trackMode
    sourceSetId.value = tt.sourceSetId ?? null
  },
  reset: () => {
    name.value = ''; color.value = '#6366f1'; mode.value = 'clip'; sourceSetId.value = null
  },
  payload: () => ({
    name:        name.value.trim(),
    color:       color.value || null,
    trackMode:   mode.value,
    sourceSetId: sourceSetId.value,
  }),
  validate:      () => !!name.value.trim(),
  failedMessage: () => t('trackTypes.failedToSave'),
})
</script>

<template>
  <FormDialog
    :open="open"
    :title="isEdit ? $t('trackTypes.editDialog.title') : $t('trackTypes.addDialog.title')"
    :submit-label="isEdit ? $t('trackTypes.save') : $t('trackTypes.create')"
    :cancel-label="$t('trackTypes.cancel')"
    :loading="loading"
    :disabled="!name.trim()"
    :error="error"
    @update:open="$emit('update:open', $event)"
    @submit="submit"
  >
    <FormField for="tt-name" :label="$t('trackTypes.name')">
      <Input id="tt-name" v-model="name" :placeholder="$t('trackTypes.namePlaceholder')" maxlength="64" autofocus required />
    </FormField>

    <div class="flex gap-3">
      <FormField :label="$t('trackTypes.color')" class="shrink-0">
        <input v-model="color" type="color" class="h-9 w-14 rounded-md border border-input bg-background cursor-pointer p-1" />
      </FormField>
      <FormField :label="$t('trackTypes.mode')" class="flex-1">
        <SwitchTab v-model="mode" :options="modeOptions" />
      </FormField>
    </div>

    <FormField :label="$t('trackTypes.sourceSet')">
      <SelectMenu
        v-model="sourceSetId"
        :options="sourceSetOptions"
        :null-label="$t('trackTypes.noSourceSet')"
      >
        <template #icon="{ option }">
          <Icon v-if="option" icon="mdi:layers-outline" class="size-4 text-muted-foreground" />
        </template>
      </SelectMenu>
    </FormField>
  </FormDialog>
</template>
