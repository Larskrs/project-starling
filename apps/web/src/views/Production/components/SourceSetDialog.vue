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
import { useApi } from '../../../composables/useApi.js'

const props = defineProps({
  open:      { type: Boolean, required: true },
  sourceSet: { type: Object,  default: null },  // null → create mode
})

const emit = defineEmits(['update:open', 'created', 'updated'])

const route      = useRoute()
const { t }      = useI18n()
const { $fetch } = useApi()

const name    = ref('')
const loading = ref(false)
const error   = ref('')

const isEdit = computed(() => props.sourceSet !== null)

watch(() => props.open, (open) => {
  if (!open) return
  name.value    = isEdit.value ? props.sourceSet.name : ''
  error.value   = ''
  loading.value = false
})

function close() { emit('update:open', false) }

const baseUrl = computed(() =>
  `/api/company/${route.params.cslug}/production/${route.params.pslug}/source-sets`
)

async function submit() {
  if (!name.value.trim()) return
  loading.value = true
  error.value   = ''
  const url = isEdit.value ? `${baseUrl.value}/${props.sourceSet.id}` : baseUrl.value
  const { ok, data, error: err } = await $fetch(url, {
    method: isEdit.value ? 'PATCH' : 'POST',
    json: { name: name.value.trim() },
    silent: true,
  })
  loading.value = false
  if (!ok) { error.value = err ?? t('sourceSets.failedToSave'); return }
  emit(isEdit.value ? 'updated' : 'created', data)
  close()
}
</script>

<template>
  <Dialog :open="open" @update:open="!$event && close()">
    <DialogContent class="max-w-sm p-6 flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{{ isEdit ? $t('sourceSets.renameDialog.title') : $t('sourceSets.addDialog.title') }}</DialogTitle>
      </DialogHeader>

      <form class="flex flex-col gap-3" @submit.prevent="submit">
        <div class="flex flex-col gap-1.5">
          <Label for="ss-name">{{ $t('sourceSets.name') }}</Label>
          <Input
            id="ss-name"
            v-model="name"
            :placeholder="$t('sourceSets.namePlaceholder')"
            maxlength="128"
            autofocus
            required
          />
        </div>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

        <DialogFooter class="pt-1">
          <Button type="button" variant="outline" @click="close">{{ $t('sourceSets.cancel') }}</Button>
          <Button type="submit" :disabled="!name.trim() || loading">
            {{ loading ? '…' : (isEdit ? $t('sourceSets.save') : $t('sourceSets.create')) }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
