<script setup>
import { ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import ProductionList from './ProductionList.vue'
import { useApi } from '../../composables/useApi.js'

const route  = useRoute()
const { $fetch } = useApi()
const company = ref(null)
const loading = ref(true)
const error   = ref('')

async function load(slug) {
  loading.value = true
  error.value   = ''
  company.value = null
  const { ok, data, status } = await $fetch(`/api/company/${slug}`, { silent: true })
  loading.value = false
  if (status === 404) { error.value = `Company "${slug}" could not be found`; return }
  if (!ok) { error.value = 'Could not load company'; return }
  company.value = data
}

onMounted(() => load(route.params.slug))
watch(() => route.params.slug, (slug) => { if (slug) load(slug) })
</script>

<template>
  <div class="container mx-auto px-6 py-10">
    <p v-if="loading" class="text-sm text-muted-foreground">Loading...</p>
    <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>
    <template v-else-if="company">

      <div class="mb-8">
        <h1 class="text-2xl font-bold text-foreground">{{ company.name }}</h1>
        <p class="text-sm text-muted-foreground font-mono mt-0.5">{{ company.slug }}</p>
      </div>

      <ProductionList :company="company" />

    </template>
  </div>
</template>
