<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ProductionList from './ProductionList.vue'
import FileExplorer   from '../../components/storage/FileExplorer.vue'
import Tabs           from '../../components/ui/Tabs.vue'

const route  = useRoute()
const router = useRouter()
const company = ref(null)
const loading = ref(true)
const error   = ref('')

const VALID_TABS = ['productions', 'files']

const activeTab = computed({
  get: () => VALID_TABS.includes(route.query.tab) ? route.query.tab : 'productions',
  set: (tab) => router.replace({ query: { ...route.query, tab } }),
})

const TABS = [
  { id: 'productions', label: 'Productions', icon: 'mdi:film' },
  { id: 'files',       label: 'Files',       icon: 'mdi:folder-outline' },
]

async function load(slug) {
  loading.value = true
  error.value   = ''
  company.value = null

  try {
    const res = await fetch(`/api/company/${slug}`, { credentials: 'include' })

    if (res.status === 404) {
      error.value = `Company "${slug}" could not be found`
      return
    }
    if (!res.ok) throw new Error(`Request failed with status ${res.status}`)

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
  <div class="container mx-auto px-6 py-10">
    <p v-if="loading" class="text-sm text-muted-foreground">Loading...</p>
    <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>
    <template v-else-if="company">

      <Tabs v-model="activeTab" :tabs="TABS" />

      <div class="mt-6">
        <ProductionList v-if="activeTab === 'productions'" :company="company" />
        <FileExplorer   v-else-if="activeTab === 'files'"  :company-id="company.id" />
      </div>

    </template>
  </div>
</template>
