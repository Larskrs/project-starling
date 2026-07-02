<script setup>
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import Dialog        from '@starling/ui/Dialog'
import DialogContent from '@starling/ui/DialogContent'
import DialogHeader  from '@starling/ui/DialogHeader'
import DialogTitle   from '@starling/ui/DialogTitle'
import DialogFooter  from '@starling/ui/DialogFooter'
import { Input, Label, Button, SelectMenu, SwitchTab } from '@starling/ui'
import { useApi } from '../../../composables/useApi.js'

const props = defineProps({
  open:       { type: Boolean, required: true },
  trackType:  { type: Object,  default: null },
  sourceSets: { type: Array,   default: () => [] },
})

const emit = defineEmits(['update:open', 'created', 'updated'])

const route      = useRoute()
const { t }      = useI18n()
const { $fetch } = useApi()

const name        = ref('')
const color       = ref('#6366f1')
const mode        = ref('clip')
const sourceSetId = ref(null)
const loading     = ref(false)
const error       = ref('')

const isEdit = computed(() => props.trackType !== null)

const modeOptions      = computed(() => [
  { value: 'clip',  label: t('trackTypes.modeClip') },
  { value: 'event', label: t('trackTypes.modeEvent') },
])
const sourceSetOptions = computed(() =>
  props.sourceSets.map(s => ({ value: s.id, label: s.name }))
)

watch(() => props.open, (open) => {
  if (!open) return
  error.value   = ''
  loading.value = false
  if (isEdit.value) {
    name.value        = props.trackType.name
    color.value       = props.trackType.color ?? '#6366f1'
    mode.value        = props.trackType.trackMode
    sourceSetId.value = props.trackType.sourceSetId ?? null
  } else {
    name.value = ''; color.value = '#6366f1'; mode.value = 'clip'; sourceSetId.value = null
  }
})

function close() { emit('update:open', false) }

async function submit() {
  if (!name.value.trim()) return
  loading.value = true
  error.value   = ''
  const base = `/api/company/${route.params.cslug}/production/${route.params.pslug}/track-types`
  const url  = isEdit.value ? `${base}/${props.trackType.id}` : base
  const { ok, data, error: err } = await $fetch(url, {
    method: isEdit.value ? 'PATCH' : 'POST',
    json: { name: name.value.trim(), color: color.value || null, trackMode: mode.value, sourceSetId: sourceSetId.value },
    silent: true,
  })
  loading.value = false
  if (!ok) { error.value = err ?? t('trackTypes.failedToSave'); return }
  emit(isEdit.value ? 'updated' : 'created', data)
  close()
}
</script>

<template>
  <Dialog :open="open" @update:open="!$event && close()">
    <DialogContent class="max-w-sm p-6 flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? $t('trackTypes.editDialog.title') : $t('trackTypes.addDialog.title') }}</DialogTitle>
      </DialogHeader>

      <form class="flex flex-col gap-3" @submit.prevent="submit">

        <div class="flex flex-col gap-1.5">
          <Label for="tt-name">{{ $t('trackTypes.name') }}</Label>
          <Input id="tt-name" v-model="name" :placeholder="$t('trackTypes.namePlaceholder')" maxlength="64" autofocus required />
        </div>

        <div class="flex gap-3">
          <div class="flex flex-col gap-1.5 shrink-0">
            <Label>{{ $t('trackTypes.color') }}</Label>
            <input v-model="color" type="color" class="h-9 w-14 rounded-md border border-input bg-background cursor-pointer p-1" />
          </div>
          <div class="flex flex-col gap-1.5 flex-1">
            <Label>{{ $t('trackTypes.mode') }}</Label>
            <SwitchTab v-model="mode" :options="modeOptions" />
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label>{{ $t('trackTypes.sourceSet') }}</Label>
          <SelectMenu
            v-model="sourceSetId"
            :options="sourceSetOptions"
            :null-label="$t('trackTypes.noSourceSet')"
          >
            <template #icon="{ option }">
              <Icon v-if="option" icon="mdi:layers-outline" class="size-4 text-muted-foreground" />
            </template>
          </SelectMenu>
        </div>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

        <DialogFooter class="pt-1">
          <Button type="button" variant="outline" @click="close">{{ $t('trackTypes.cancel') }}</Button>
          <Button type="submit" :disabled="!name.trim() || loading">
            {{ loading ? '…' : (isEdit ? $t('trackTypes.save') : $t('trackTypes.create')) }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
