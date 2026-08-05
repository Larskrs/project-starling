<script setup>
import { ref, computed, inject, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { FormField, Input, SplitDialog, Switch } from '@starling/ui'
import { useApi } from '../../../composables/useApi'

const props = defineProps({
  open:    { type: Boolean, required: true },
  presets: { type: Array,   default: () => [] },
})

const emit = defineEmits(['update:open', 'created', 'set-created'])

const data = inject('production-data')
const { t } = useI18n()
const { $fetch } = useApi()

const selectedId    = ref(null)
const name          = ref('')
const makeCameraSet = ref(false)
const cameraSetName = ref('')
const cameraCount   = ref(4)

const loading = ref(false)
const error   = ref('')

const selected = computed(() => props.presets.find(p => p.id === selectedId.value) ?? null)

watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  error.value = ''
  loading.value = false
  selectedId.value = props.presets[0]?.id ?? null
  name.value = props.presets[0]?.name ?? ''
  makeCameraSet.value = false
  cameraSetName.value = t('trackTypes.presets.cameraSetNameDefault')
  cameraCount.value = 4
})

function pick(preset) {
  // Keep a user-typed name unless it still matches the previous preset's default.
  if (!name.value.trim() || name.value === selected.value?.name) name.value = preset.name
  selectedId.value = preset.id
}

const cameraSetValid = computed(() => {
  if (!makeCameraSet.value) return true
  const n = Number(cameraCount.value)
  return !!cameraSetName.value.trim() && Number.isInteger(n) && n >= 1 && n <= 64
})

const valid = computed(() => {
  if (!selected.value || !name.value.trim()) return false
  return !selected.value.supportsCameraSet || cameraSetValid.value
})

const cameraHues = computed(() => {
  const n = Math.min(Math.max(Number(cameraCount.value) || 0, 0), 64)
  const base = selected.value?.settings?.hue ?? 0
  return Array.from({ length: n }, (_, i) => (base + Math.round((i * 360) / n)) % 360)
})

async function submit() {
  if (!valid.value) return
  loading.value = true
  error.value = ''
  const payload = {
    presetId: selected.value.id,
    name:     name.value.trim(),
  }
  if (makeCameraSet.value && selected.value.supportsCameraSet) {
    payload.cameraSet = { name: cameraSetName.value.trim(), count: Number(cameraCount.value) }
  }
  const { ok, data: res, error: err } = await $fetch(
    `/api/production/${data.value?.production?.id}/track-types/from-preset`,
    { method: 'POST', json: payload, silent: true },
  )
  loading.value = false
  if (!ok) { error.value = err ?? t('trackTypes.presets.failedToCreate'); return }
  if (res.sourceSet) emit('set-created', res.sourceSet)
  emit('created', res.trackType)
  emit('update:open', false)
}
</script>

<template>
  <SplitDialog
    :open="open"
    :title="$t('trackTypes.presets.dialogTitle')"
    :submit-label="$t('trackTypes.create')"
    :cancel-label="$t('trackTypes.cancel')"
    :loading="loading"
    :disabled="!valid"
    :error="error"
    :split="!!selected?.supportsCameraSet"
    @update:open="$emit('update:open', $event)"
    @submit="submit"
  >
    <template #left>
      <FormField :label="$t('trackTypes.presets.preset')">
        <div class="flex flex-col gap-1.5">
          <button
            v-for="preset in presets"
            :key="preset.id"
            type="button"
            class="flex items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors"
            :class="preset.id === selectedId
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-muted-foreground/40'"
            @click="pick(preset)"
          >
            <Icon
              v-if="preset.settings.icon"
              :icon="preset.settings.icon"
              class="mt-0.5 size-4 shrink-0"
              :style="{ color: `oklch(65% 0.18 ${preset.settings.hue})` }"
            />
            <span
              v-else
              class="mt-1 size-2.5 shrink-0 rounded-full"
              :style="{ backgroundColor: `oklch(65% 0.18 ${preset.settings.hue})` }"
            />
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="text-sm font-medium text-foreground">{{ preset.name }}</span>
              <span class="text-xs text-muted-foreground">{{ preset.description }}</span>
            </span>
          </button>
        </div>
      </FormField>

      <FormField for="ttp-name" :label="$t('trackTypes.name')">
        <Input id="ttp-name" v-model="name" :placeholder="$t('trackTypes.namePlaceholder')" maxlength="64" required />
      </FormField>
    </template>

    <!-- Camera set — only offered by camera presets -->
    <template #right>
      <label class="flex cursor-pointer select-none items-center justify-between gap-3">
        <span class="text-sm font-medium text-foreground">{{ $t('trackTypes.presets.createCameraSet') }}</span>
        <Switch v-model="makeCameraSet" />
      </label>

      <FormField for="ttp-set-name" :label="$t('trackTypes.presets.cameraSetName')">
        <Input id="ttp-set-name" v-model="cameraSetName" :disabled="!makeCameraSet" maxlength="128" required />
      </FormField>

      <FormField for="ttp-count" :label="$t('trackTypes.presets.cameraCount')">
        <Input id="ttp-count" v-model="cameraCount" :disabled="!makeCameraSet" type="number" min="1" max="64" step="1" required />
      </FormField>

      <!-- Hue preview: how the camera colours will be spread -->
      <div v-if="makeCameraSet && cameraHues.length" class="flex flex-wrap items-center gap-1.5">
        <Icon icon="mdi:video-outline" class="size-4 text-muted-foreground" />
        <span
          v-for="(h, i) in cameraHues"
          :key="i"
          class="size-3 rounded-full"
          :style="{ backgroundColor: `oklch(65% 0.18 ${h})` }"
        />
      </div>
    </template>
  </SplitDialog>
</template>
