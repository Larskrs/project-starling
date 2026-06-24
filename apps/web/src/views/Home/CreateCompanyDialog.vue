<script setup>
import { ref, watch } from 'vue'
import Dialog from '../../components/ui/Dialog.vue'
import Input  from '../../components/ui/Input.vue'
import Label  from '../../components/ui/Label.vue'
import Button from '../../components/ui/Button.vue'
import { useApi } from '../../composables/useApi.js'

const props = defineProps({
  open: { type: Boolean, required: true },
})

const emit = defineEmits(['close', 'created'])

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
  const { ok, data, error: fetchErr } = await $fetch('/api/company', {
    method: 'POST',
    json:   { name: name.value, slug: slug.value },
    silent: true,
  })
  loading.value = false
  if (!ok) { error.value = fetchErr ?? 'Feilet ved oppretting av produksjonshus'; return }
  emit('created', data.company)
  emit('close')
}
</script>

<template>
  <Dialog :open="open" class="max-w-md" @close="emit('close')">
    <div class="p-6 flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <h2 class="text-base font-semibold text-foreground">Nytt produksjonshus</h2>
        <button class="text-muted-foreground hover:text-foreground transition-colors leading-none" @click="emit('close')">✕</button>
      </div>

      <form class="flex flex-col gap-3" @submit.prevent="handleSubmit">
        <div class="flex flex-col gap-1.5">
          <Label for="company-name">Navn</Label>
          <Input id="company-name" v-model="name" placeholder="Acme Inc." autofocus required />
        </div>

        <div class="flex flex-col gap-1.5">
          <Label for="company-slug">Sideaddresse</Label>
          <Input id="company-slug" v-model="slug" placeholder="acme-inc" @input="onSlugInput" required />
          <p class="text-xs text-muted-foreground">Brukes i URL-er — små bokstaver, tall, bindestreker.</p>
        </div>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

        <div class="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" @click="emit('close')">Avbryt</Button>
          <Button type="submit" :disabled="!name.trim() || !slug.trim() || loading">
            {{ loading ? 'Oppretter…' : 'Opprett produksjonshus' }}
          </Button>
        </div>
      </form>
    </div>
  </Dialog>
</template>
