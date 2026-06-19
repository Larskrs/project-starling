<script setup>
import { ref, watch } from 'vue'
import Dialog from '../../components/ui/Dialog.vue'
import Input  from '../../components/ui/Input.vue'
import Label  from '../../components/ui/Label.vue'
import Button from '../../components/ui/Button.vue'

const props = defineProps({
  open:    { type: Boolean, required: true },
  company: { type: Object,  required: true },
})

const emit = defineEmits(['close', 'created'])

const name       = ref('')
const slug       = ref('')
const error      = ref('')
const loading    = ref(false)
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
  try {
    const res = await fetch('/api/production', {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body:        JSON.stringify({ company_id: props.company.id, name: name.value, slug: slug.value }),
    })
    const data = await res.json()
    if (!res.ok) { error.value = data.error ?? 'Failed to create production'; return }
    emit('created', data.production)
    emit('close')
  } catch {
    error.value = 'Network error'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Dialog :open="open" class="max-w-md" @close="emit('close')">
    <div class="p-6 flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <h2 class="text-base font-semibold text-foreground">New production</h2>
        <button class="text-muted-foreground hover:text-foreground transition-colors leading-none" @click="emit('close')">✕</button>
      </div>

      <form class="flex flex-col gap-3" @submit.prevent="handleSubmit">
        <div class="flex flex-col gap-1.5">
          <Label for="production-name">Name</Label>
          <Input id="production-name" v-model="name" placeholder="My Production" autofocus required />
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="production-slug">Slug</Label>
          <Input id="production-slug" v-model="slug" placeholder="my-production" @input="onSlugInput" required />
          <p class="text-xs text-muted-foreground">Used in URLs — lowercase letters, numbers, hyphens.</p>
        </div>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

        <div class="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" @click="emit('close')">Cancel</Button>
          <Button type="submit" :disabled="!name.trim() || !slug.trim() || loading">
            {{ loading ? 'Creating…' : 'Create production' }}
          </Button>
        </div>
      </form>
    </div>
  </Dialog>
</template>
