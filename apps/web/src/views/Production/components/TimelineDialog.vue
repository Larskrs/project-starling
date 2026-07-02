<script setup>
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import Dialog        from '@starling/ui/Dialog'
import DialogContent from '@starling/ui/DialogContent'
import DialogHeader  from '@starling/ui/DialogHeader'
import DialogTitle   from '@starling/ui/DialogTitle'
import DialogFooter  from '@starling/ui/DialogFooter'
import { Input, Label, Button, SelectMenu } from '@starling/ui'
import { useApi } from '../../../composables/useApi.js'

const FRAME_RATES = ['23.976', '24', '25', '29.97', '29.97df', '30', '50', '59.94', '60']

const props = defineProps({
  open:     { type: Boolean, required: true },
  timeline: { type: Object,  default: null },
})

const emit = defineEmits(['update:open', 'created', 'updated'])

const route      = useRoute()
const { t }      = useI18n()
const { $fetch } = useApi()

const name            = ref('')
const frameRate       = ref('25')
const startFrame      = ref(0)
const endFrame        = ref(86400)
const ltcOffsetFrames = ref(0)
const loading         = ref(false)
const error           = ref('')

const isEdit = computed(() => props.timeline !== null)

const frameRateOptions = computed(() =>
  FRAME_RATES.map(r => ({ value: r, label: `${r} fps` }))
)

watch(() => props.open, (open) => {
  if (!open) return
  error.value   = ''
  loading.value = false
  if (isEdit.value) {
    name.value            = props.timeline.name
    frameRate.value       = props.timeline.frameRate
    startFrame.value      = props.timeline.startFrame
    endFrame.value        = props.timeline.endFrame
    ltcOffsetFrames.value = props.timeline.ltcOffsetFrames
  } else {
    name.value = ''; frameRate.value = '25'; startFrame.value = 0; endFrame.value = 86400; ltcOffsetFrames.value = 0
  }
})

function close() { emit('update:open', false) }

const endFrameError = computed(() =>
  endFrame.value <= startFrame.value ? t('timelines.endFrameMustBeAfterStart') : ''
)

async function submit() {
  if (!name.value.trim() || endFrameError.value) return
  loading.value = true
  error.value   = ''
  const base = `/api/company/${route.params.cslug}/production/${route.params.pslug}/timelines`
  const url  = isEdit.value ? `${base}/${props.timeline.id}` : base
  const { ok, data, error: err } = await $fetch(url, {
    method: isEdit.value ? 'PATCH' : 'POST',
    json: {
      name:            name.value.trim(),
      frameRate:       frameRate.value,
      startFrame:      Number(startFrame.value),
      endFrame:        Number(endFrame.value),
      ltcOffsetFrames: Number(ltcOffsetFrames.value),
    },
    silent: true,
  })
  loading.value = false
  if (!ok) { error.value = err ?? t('timelines.failedToSave'); return }
  emit(isEdit.value ? 'updated' : 'created', data)
  close()
}
</script>

<template>
  <Dialog :open="open" @update:open="!$event && close()">
    <DialogContent class="max-w-sm p-6 flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? $t('timelines.editDialog.title') : $t('timelines.addDialog.title') }}</DialogTitle>
      </DialogHeader>

      <form class="flex flex-col gap-3" @submit.prevent="submit">

        <div class="flex flex-col gap-1.5">
          <Label for="tl-name">{{ $t('timelines.name') }}</Label>
          <Input id="tl-name" v-model="name" :placeholder="$t('timelines.namePlaceholder')" maxlength="128" autofocus required />
        </div>

        <div class="flex flex-col gap-1.5">
          <Label>{{ $t('timelines.frameRate') }}</Label>
          <SelectMenu v-model="frameRate" :options="frameRateOptions" />
        </div>

        <div class="flex gap-3">
          <div class="flex flex-col gap-1.5 flex-1">
            <Label for="tl-start">{{ $t('timelines.startFrame') }}</Label>
            <Input id="tl-start" v-model.number="startFrame" type="number" min="0" step="1" />
          </div>
          <div class="flex flex-col gap-1.5 flex-1">
            <Label for="tl-end">{{ $t('timelines.endFrame') }}</Label>
            <Input
              id="tl-end"
              v-model.number="endFrame"
              type="number"
              min="1"
              step="1"
              :class="endFrameError ? 'border-destructive' : ''"
            />
          </div>
        </div>
        <p v-if="endFrameError" class="text-xs text-destructive -mt-1">{{ endFrameError }}</p>

        <div class="flex flex-col gap-1.5">
          <Label for="tl-ltc">{{ $t('timelines.ltcOffset') }}</Label>
          <Input id="tl-ltc" v-model.number="ltcOffsetFrames" type="number" step="1" />
        </div>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

        <DialogFooter class="pt-1">
          <Button type="button" variant="outline" @click="close">{{ $t('timelines.cancel') }}</Button>
          <Button type="submit" :disabled="!name.trim() || !!endFrameError || loading">
            {{ loading ? '…' : (isEdit ? $t('timelines.save') : $t('timelines.create')) }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
