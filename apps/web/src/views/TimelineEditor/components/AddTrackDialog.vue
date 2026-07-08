<script setup>
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Dialog        from '@starling/ui/Dialog'
import DialogContent from '@starling/ui/DialogContent'
import DialogHeader  from '@starling/ui/DialogHeader'
import DialogTitle   from '@starling/ui/DialogTitle'
import DialogFooter  from '@starling/ui/DialogFooter'
import { Input, Label, Button, SelectMenu } from '@starling/ui'
import { useApi } from '../../../composables/useApi.js'

const props = defineProps({
  open:       { type: Boolean, required: true },
  trackTypes: { type: Array,   default: () => [] },
  timelineId: { type: String,  required: true },
})

const emit = defineEmits(['update:open', 'created'])

const { t }      = useI18n()
const { $fetch } = useApi()

const name      = ref('')
const typeId    = ref(null)
const loading   = ref(false)
const error     = ref('')

const typeOptions = computed(() =>
  props.trackTypes.map(tt => ({ value: tt.id, label: tt.name }))
)

watch(() => props.open, (open) => {
  if (!open) return
  error.value   = ''
  loading.value = false
  name.value    = ''
  typeId.value  = props.trackTypes[0]?.id ?? null
})

function close() { emit('update:open', false) }

async function submit() {
  if (!name.value.trim() || !typeId.value) return
  loading.value = true
  error.value   = ''
  const { ok, data, error: err } = await $fetch(
    `/api/timeline/${props.timelineId}/tracks`,
    {
      method: 'POST',
      json: { typeId: typeId.value, name: name.value.trim() },
      silent: true,
    },
  )
  loading.value = false
  if (!ok) { error.value = err ?? t('editor.failedToSaveTrack'); return }
  emit('created', data)
  close()
}
</script>

<template>
  <Dialog :open="open" @update:open="!$event && close()">
    <DialogContent class="max-w-sm p-6 flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{{ $t('editor.addTrackDialog.title') }}</DialogTitle>
      </DialogHeader>

      <form class="flex flex-col gap-3" @submit.prevent="submit">

        <div class="flex flex-col gap-1.5">
          <Label for="at-name">{{ $t('editor.trackName') }}</Label>
          <Input
            id="at-name"
            v-model="name"
            :placeholder="$t('editor.trackNamePlaceholder')"
            maxlength="128"
            autofocus
            required
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <Label>{{ $t('editor.trackType') }}</Label>
          <SelectMenu
            v-model="typeId"
            :options="typeOptions"
            :null-label="$t('editor.selectTrackType')"
          />
        </div>

        <p v-if="!trackTypes.length" class="text-xs text-muted-foreground">
          {{ $t('editor.noTrackTypes') }}
        </p>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

        <DialogFooter class="pt-1">
          <Button type="button" variant="outline" @click="close">{{ $t('editor.cancel') }}</Button>
          <Button type="submit" :disabled="!name.trim() || !typeId || loading || !trackTypes.length">
            {{ loading ? '…' : $t('editor.addTrack') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
