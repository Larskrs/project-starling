<script setup>
import { ref, onMounted }    from 'vue'
import { Icon }              from '@iconify/vue'
import Image                 from '@starling/ui/Image'
import ListCard              from '@starling/ui/ListCard'
import ListHeader            from '@starling/ui/ListHeader'
import ListItem              from '@starling/ui/ListItem'
import CreateCompanyDialog   from './CreateCompanyDialog.vue'
import { useApi }            from '../../composables/useApi.js'

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
  <ListCard>

    <ListHeader :title="$t('company.title')">
      <template #action>
        <button
          class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          @click="dialogOpen = true"
        >
          <Icon icon="mdi:plus" class="text-sm" />
          {{ $t('company.new') }}
        </button>
      </template>
    </ListHeader>

    <div v-if="loading" class="flex items-center justify-center py-12 text-muted-foreground">
      <Icon icon="mdi:loading" class="animate-spin text-xl" />
    </div>

    <p v-else-if="error" class="px-5 py-4 text-sm text-destructive">{{ $t(error) }}</p>

    <div v-else-if="!companies.length" class="flex flex-col items-center gap-2 py-12 text-center">
      <p class="text-sm text-muted-foreground">{{ $t('company.noCompanies') }}</p>
      <button class="text-xs text-primary hover:underline underline-offset-2" @click="dialogOpen = true">
        {{ $t('company.createOne') }}
      </button>
    </div>

    <ul v-else class="divide-y divide-border">
      <ListItem v-for="c in companies" :key="c.id" :to="`/c/${c.slug}`">
        <Image v-if="c.profileImageId" :id="c.profileImageId" :quality="25" class="size-8 rounded-md object-cover shrink-0" />
        <span class="text-sm text-foreground truncate flex-1">{{ c.name }}</span>
      </ListItem>
    </ul>

  </ListCard>

  <CreateCompanyDialog :open="dialogOpen" @close="dialogOpen = false" @created="onCreated" />
</template>
