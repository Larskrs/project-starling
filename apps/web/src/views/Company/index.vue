<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import ProductionList from './ProductionList.vue'
import FileExplorer   from '../../components/storage/FileExplorer.vue'

const route = useRoute()
const company = ref(null)
const loading = ref(true)
const error = ref('')

async function load(slug) {
  loading.value = true
  error.value = ''
  company.value = null
  
  try {
    const res = await fetch(`/api/company/${slug}`, { credentials: 'include' })

    if (res.status === 404) {
      error.value = `Company "${slug}" could not be found`
      return
    }
    if (!res.ok) {
      throw new Error(`Request failed with status ${res.status}`)
    }

    company.value = await res.json()
  } catch (err) {
    error.value = 'Could not load company'
    console.error('Failed to load company:', err)
  } finally {
    loading.value = false
  }
}

onMounted(() => load(route.params.slug))
watch(() => route.params.slug, (slug) => { if (slug) load(slug) })
</script>

<template>
  <div class="max-w-5xl mx-auto px-6 py-10">
    <p v-if="loading" class="text-sm text-muted-foreground">Loading...</p>
    <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>
    <template v-else-if="company">
      <div class="flex flex-col gap-1 mb-8">
        <h1 class="text-2xl font-semibold">{{ company.name }}</h1>
        <p class="text-sm text-muted-foreground font-mono">{{ company.slug }}</p>
      </div>
      <ProductionList :company="company" />
      <div class="mt-10 border-t border-border pt-8">
        <FileExplorer :company-id="company.id" />
      </div>
    </template>
  </div>
</template>
