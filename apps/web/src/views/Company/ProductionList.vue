<script setup>
import { ref, onMounted } from 'vue'
import Button from '../../components/ui/Button.vue'
import CreateProductionDialog from './CreateProductionDialog.vue'
import { Icon } from '@iconify/vue'

const props = defineProps({
  company: { type: Object, required: true },
})

const productions = ref([])
const loading     = ref(true)
const error       = ref('')
const dialogOpen  = ref(false)

async function load() {
  loading.value = true
  error.value   = ''
  try {
    const res = await fetch(`/api/production?cid=${props.company.id}`, { credentials: 'include' })
    if (!res.ok) throw new Error()
    productions.value = await res.json()
  } catch {
    error.value = 'Could not load productions'
  } finally {
    loading.value = false
  }
}

function onCreated(production) {
  productions.value = [production, ...productions.value]
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold text-foreground">Productions</h2>
      <Button size="sm" @click="dialogOpen = true">New production</Button>
    </div>

    <p v-if="loading" class="text-sm text-muted-foreground">Loading...</p>

    <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>

    <div v-else-if="productions.length === 0" class="rounded-lg border border-dashed border-border py-12 text-center">
      <p class="text-sm text-muted-foreground">No productions yet.</p>
      <Button variant="ghost" size="sm" class="mt-2" @click="dialogOpen = true">Create the first</Button>
    </div>

    <ul v-else class="flex flex-col gap-2">
      <li
        v-for="p in productions"
        :key="p.id"
        class="border border-border rounded-lg flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
      >
        <div>
          <p class="text-sm font-medium text-foreground">{{ p.name }}</p>
          <p class="text-xs text-muted-foreground font-mono">{{ p.slug }}</p>
        </div>
        <Icon icon="mdi:arrow-right" class="text-muted-foreground/50" />
      </li>
    </ul>
  </div>

  <CreateProductionDialog
    :open="dialogOpen"
    :company="company"
    @close="dialogOpen = false"
    @created="onCreated"
  />
</template>
