<script setup>
import { ref, onMounted } from 'vue'
import { Icon }            from '@iconify/vue'
import CreateCompanyDialog from './CreateCompanyDialog.vue'
import { useApi }          from '../../composables/useApi.js'
import Image from '@starling/ui/Image'

const { $fetch } = useApi()

const companies  = ref([])
const loading    = ref(true)
const error      = ref('')
const dialogOpen = ref(false)

async function load() {
  loading.value = true
  error.value   = ''
  const { ok, data } = await $fetch('/api/company', { silent: true })
  loading.value = false
  if (!ok) { error.value = 'company.failedToLoad'; return }
  companies.value = data.companyList
}

function onCreated(company) {
  companies.value = [...companies.value, company]
}

onMounted(load)

</script>

<template>
  <section class="rounded-xl border border-border bg-card overflow-hidden">

    <div class="flex items-center justify-between px-5 py-3.5 border-b border-border">
      <h2 class="text-sm font-semibold">{{ $t('company.title') }}</h2>
      <button
        class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        @click="dialogOpen = true"
      >
        <Icon icon="mdi:plus" class="text-sm" />
        {{ $t('company.new') }}
      </button>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-12 text-muted-foreground">
      <Icon icon="mdi:loading" class="animate-spin text-xl" />
    </div>

    <div v-else-if="error" class="px-5 py-4 text-sm text-destructive">{{ $t(error) }}</div>

    <div v-else-if="!companies.length" class="flex flex-col items-center gap-2 py-12 text-center">
      <p class="text-sm text-muted-foreground">{{ $t('company.noCompanies') }}</p>
      <button class="text-xs text-primary hover:underline underline-offset-2" @click="dialogOpen = true">
        {{ $t('company.createOne') }}
      </button>
    </div>

    <ul v-else class="divide-y divide-border">
      <li v-for="c in companies" :key="c.id">
        <router-link
          :to="`/c/${c.slug}`"
          class="group flex items-center gap-3 px-5 py-3.5 hover:bg-muted/40 transition-colors"
        >
          <Image v-if="c.profileImageId" :id="c.profileImageId" :quality="25" class="size-7 rounded-md object-cover shrink-0" />
          <span class="text-sm text-foreground truncate flex-1">{{ c.name }}</span>
          <Icon
            icon="mdi:arrow-right"
            class="text-sm text-muted-foreground/20 group-hover:text-muted-foreground/60 shrink-0 transition-colors"
          />
        </router-link>
      </li>
    </ul>

  </section>

  <CreateCompanyDialog
    :open="dialogOpen"
    @close="dialogOpen = false"
    @created="onCreated"
  />
</template>
