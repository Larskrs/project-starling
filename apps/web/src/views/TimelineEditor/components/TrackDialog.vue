<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FormDialog, FormField, IconPicker, Input } from '@starling/ui'
import { useIconPicker } from '../../../composables/useIconPicker'
import { useApi } from '../../../composables/useApi'
import type { EditorTrack } from '../../../types/timeline'

// Per-track settings. The icon is an override: leaving it empty keeps whatever
// the track type provides, which is why the "none" choice names the type's icon
// rather than promising no icon at all.
const props = withDefaults(defineProps<{
  open: boolean
  /** null while the dialog is closed — there is no track to edit yet. */
  track?: EditorTrack | null
}>(), { track: null })

const emit = defineEmits<{
  'update:open': [open: boolean]
  saved: [track: EditorTrack]
}>()

const { t }      = useI18n()
const { $fetch } = useApi()
const iconPicker = useIconPicker()

const name    = ref('')
const icon    = ref<string | null>(null)
const loading = ref(false)
const error   = ref('')

watch(() => props.open, (open) => {
  if (!open || !props.track) return
  error.value   = ''
  loading.value = false
  name.value    = props.track.name ?? ''
  icon.value    = props.track.icon ?? null
})

// With nothing to inherit, "none" means exactly that; otherwise it names what
// the track falls back to.
const inheritLabel = computed(() => {
  if (!props.track?.typeIcon) return t('icons.none')
  return props.track.typeName
    ? t('editor.trackIconInheritNamed', { name: props.track.typeName })
    : t('editor.trackIconInherit')
})

const valid = computed(() => !!name.value.trim())

async function submit() {
  if (!valid.value || !props.track) return
  loading.value = true
  error.value   = ''
  const { ok, data, error: err } = await $fetch(
    `/api/timeline/${props.track.timelineId}/tracks/${props.track.id}`,
    { method: 'PATCH', json: { name: name.value.trim(), icon: icon.value }, silent: true },
  )
  loading.value = false
  if (!ok) { error.value = err ?? t('editor.failedToSaveTrack'); return }
  emit('saved', data)
  emit('update:open', false)
}
</script>

<template>
  <FormDialog
    :open="open"
    :title="$t('editor.trackDialog.title')"
    :submit-label="$t('editor.save')"
    :cancel-label="$t('editor.cancel')"
    :loading="loading"
    :disabled="!valid"
    :error="error"
    @update:open="$emit('update:open', $event)"
    @submit="submit"
  >
    <FormField for="td-name" :label="$t('editor.trackName')">
      <Input id="td-name" v-model="name" maxlength="128" autofocus required />
    </FormField>

    <FormField :label="$t('editor.trackIcon')">
      <IconPicker
        v-model="icon"
        v-bind="iconPicker"
        :hue="track?.typeHue ?? undefined"
        allow-none
        :none-label="inheritLabel"
      />
    </FormField>

    <p class="text-xs text-muted-foreground">{{ $t('editor.trackIconDescription') }}</p>
  </FormDialog>
</template>
