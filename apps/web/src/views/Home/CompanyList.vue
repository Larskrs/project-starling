<script setup>
import { ref, onMounted } from 'vue'
import Button              from '../../components/ui/Button.vue'
import CreateCompanyDialog from './CreateCompanyDialog.vue'
import { Icon } from '@iconify/vue'

const companies    = ref([])
const loading      = ref(true)
const error        = ref('')
const dialogOpen   = ref(false)

async function load() {
  loading.value = true
  error.value   = ''
  try {
    const res = await fetch('/api/company', { credentials: 'include' })
    if (!res.ok) throw new Error('Feil ved lasting av selskaper')
    const data = await res.json()
    companies.value = data.companyList
  } catch {
    error.value = 'Feil ved lasting av selskaper'
  } finally {
    loading.value = false
  }
}

function onCreated(company) {
  companies.value = [...companies.value, company]
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">

    <!-- Header -->
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold text-foreground">Produksjonshus</h2>
      <Button size="sm" @click="dialogOpen = true">Nytt produksjonshus</Button>
    </div>

    <!-- Loading -->
    <p v-if="loading" class="text-sm text-muted-foreground">Laster inn...</p>

    <!-- Error -->
    <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>

    <!-- Empty -->
    <div v-else-if="companies.length === 0" class="rounded-lg border-1 border-dashed border-border py-12 text-center">
      <p class="text-sm text-muted-foreground">Ingen produksjonshus ennå.</p>
      <Button variant="ghost" size="sm" class="mt-2" @click="dialogOpen = true">Opprett det første</Button>
    </div>

    <!-- List -->
    <ul v-else class="flex flex-col gap-2">
      <li v-for="c in companies" :key="c.id" class="hover:bg-muted/50 transition-colors">
        <router-link
          :to="`/c/${c.slug}`"
          class="border border-border rounded-lg group flex items-center justify-between px-4 py-3"
        >
          <div>
            <p class="text-sm font-medium text-foreground">{{ c.name }}</p>
            <p class="text-xs text-muted-foreground font-mono">{{ c.slug }}</p>
          </div>
          <Icon icon="mdi:arrow-right" class="text-muted-foreground/50 group-hover:text-muted-foreground transition-colors duration-300" />
        </router-link>
      </li>
    </ul>

  </div>

  <CreateCompanyDialog
    :open="dialogOpen"
    @close="dialogOpen = false"
    @created="onCreated"
  />
</template>
