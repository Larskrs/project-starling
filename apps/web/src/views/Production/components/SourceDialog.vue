<script setup>
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Dialog        from '@starling/ui/Dialog'
import DialogContent from '@starling/ui/DialogContent'
import DialogHeader  from '@starling/ui/DialogHeader'
import DialogTitle   from '@starling/ui/DialogTitle'
import DialogFooter  from '@starling/ui/DialogFooter'
import { Input, Label, Button } from '@starling/ui'
import HuePicker from './HuePicker.vue'
import { useApi } from '../../../composables/useApi.js'

const props = defineProps({
  open:   { type: Boolean, required: true },
  setId:  { type: String,  required: true },
  source: { type: Object,  default: null },   // null → create mode
})

const emit = defineEmits(['update:open', 'created', 'updated'])

const route      = useRoute()
const { t }      = useI18n()
const { $fetch } = useApi()

const name      = ref('')
const shortName = ref('')
const hue       = ref(200)
const loading   = ref(false)
const error     = ref('')

const isEdit = computed(() => props.source !== null)

watch(() => props.open, (open) => {
  if (!open) return
  error.value   = ''
  loading.value = false
  if (isEdit.value) {
    name.value      = props.source.name
    shortName.value = props.source.shortName
    hue.value       = props.source.hue
  } else {
    name.value      = ''
    shortName.value = ''
    hue.value       = 200
  }
})

function close() { emit('update:open', false) }

const baseUrl = computed(() =>
  `/api/company/${route.params.cslug}/production/${route.params.pslug}/source-sets/${props.setId}/sources`
)

async function submit() {
  if (!name.value.trim() || !shortName.value.trim()) return
  loading.value = true
  error.value   = ''
  const url = isEdit.value ? `${baseUrl.value}/${props.source.id}` : baseUrl.value
  const { ok, data, error: err } = await $fetch(url, {
    method: isEdit.value ? 'PATCH' : 'POST',
    json: { name: name.value.trim(), shortName: shortName.value.trim(), hue: hue.value },
    silent: true,
  })
  loading.value = false
  if (!ok) { error.value = err ?? t('sources.failedToSave'); return }
  emit(isEdit.value ? 'updated' : 'created', data)
  close()
}
</script>

<template>
  <Dialog :open="open" @update:open="!$event && close()">
    <DialogContent class="max-w-sm p-6 flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? $t('sources.editDialog.title') : $t('sources.addDialog.title') }}</DialogTitle>
      </DialogHeader>

      <form class="flex flex-col gap-3" @submit.prevent="submit">
        <!-- Name -->
         <div class="grid grid-cols-4 gap-1">

          <!-- Short name -->
          <div class="flex flex-col gap-1.5">
            <Label for="src-short">{{ $t('sources.shortName') }}</Label>
            <Input
              id="src-short"
              v-model="shortName"
              :placeholder="$t('sources.shortNamePlaceholder')"
              maxlength="16"
              required
            />
          </div>

          <div class="flex flex-col gap-1.5 col-span-3">
            <Label for="src-name">{{ $t('sources.name') }}</Label>
            <Input
              id="src-name"
              v-model="name"
              :placeholder="$t('sources.namePlaceholder')"
              maxlength="128"
              autofocus
              required
            />
          </div>
        </div>
        <!-- Hue -->
        <div class="flex flex-col gap-1.5">
          <Label>{{ $t('sources.hue') }}</Label>
          <HuePicker v-model="hue" />
        </div>

        <!-- Preview -->
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <span
            class="inline-flex items-center justify-center rounded-md px-2 py-0.5 text-xs font-bold"
            :style="{
              backgroundColor: `oklch(70% 0.25 ${hue} / 0.75)`,
              color: `oklch(22% 0.05 ${hue})`,
            }"
          >{{ shortName || '—' }}</span>
          <span>{{ name || $t('sources.namePlaceholder') }}</span>
        </div>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

        <DialogFooter class="pt-1">
          <Button type="button" variant="outline" @click="close">{{ $t('sources.cancel') }}</Button>
          <Button type="submit" :disabled="!name.trim() || !shortName.trim() || loading">
            {{ loading ? '…' : (isEdit ? $t('sources.save') : $t('sources.create')) }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
