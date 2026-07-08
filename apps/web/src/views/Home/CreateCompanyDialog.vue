<script setup>
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Dialog        from '@starling/ui/Dialog'
import DialogContent from '@starling/ui/DialogContent'
import DialogHeader  from '@starling/ui/DialogHeader'
import DialogTitle   from '@starling/ui/DialogTitle'
import DialogFooter  from '@starling/ui/DialogFooter'
import Input  from '@starling/ui/Input'
import Label  from '@starling/ui/Label'
import Button from '@starling/ui/Button'
import { useApi } from '../../composables/useApi.js'

const props = defineProps({
  open: { type: Boolean, required: true },
})

const emit = defineEmits(['close', 'created'])

const { t } = useI18n()
const { $fetch } = useApi()

const name    = ref('')
const slug    = ref('')
const error   = ref('')
const loading = ref(false)
const slugEdited = ref(false)

function toSlug(val) {
  return val.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

watch(name, (val) => {
  if (!slugEdited.value) slug.value = toSlug(val)
})

function onSlugInput() {
  slugEdited.value = true
  slug.value = toSlug(slug.value)
}

watch(() => props.open, (open) => {
  if (open) { name.value = ''; slug.value = ''; error.value = ''; slugEdited.value = false }
})

async function handleSubmit() {
  error.value   = ''
  loading.value = true
  const { ok, data, error: fetchErr } = await $fetch('/api/companies', {
    method: 'POST',
    json:   { name: name.value, slug: slug.value },
    silent: true,
  })
  loading.value = false
  if (!ok) { error.value = fetchErr ?? t('createCompany.error'); return }
  emit('created', data.company)
  emit('close')
}
</script>

<template>
  <Dialog :open="open" @update:open="!$event && emit('close')">
    <DialogContent class="max-w-md p-6 flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{{ $t('createCompany.title') }}</DialogTitle>
      </DialogHeader>

      <form class="flex flex-col gap-3" @submit.prevent="handleSubmit">
        <div class="flex flex-col gap-1.5">
          <Label for="company-name">{{ $t('createCompany.nameLabel') }}</Label>
          <Input id="company-name" v-model="name" :placeholder="$t('createCompany.namePlaceholder')" autofocus required />
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="company-slug">{{ $t('createCompany.slugLabel') }}</Label>
          <Input id="company-slug" v-model="slug" :placeholder="$t('createCompany.slugPlaceholder')" @input="onSlugInput" required />
          <p class="text-xs text-muted-foreground">{{ $t('createCompany.slugHint') }}</p>
        </div>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

        <DialogFooter class="pt-1">
          <Button type="button" variant="outline" @click="emit('close')">{{ $t('createCompany.cancel') }}</Button>
          <Button type="submit" :disabled="!name.trim() || !slug.trim() || loading">
            {{ loading ? $t('createCompany.creating') : $t('createCompany.create') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
