<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import Avatar from '@starling/ui/Avatar'
import Image from '@starling/ui/Image'

import ProductionList from './ProductionList.vue'
import { useApi } from '../../composables/useApi.js'
import { usePageTitle } from '../../composables/usePageTitle.js'
import { Button } from '@starling/ui'

const route  = useRoute()
const router = useRouter()
const { t } = useI18n()
const { $fetch } = useApi()
const company = ref(null)
const loading = ref(true)
const error   = ref('')

usePageTitle(computed(() => company.value?.name ?? null))

async function load(slug) {
  loading.value = true
  error.value   = ''
  company.value = null
  const { ok, data, status } = await $fetch(`/api/company/${slug}`, { silent: true })
  loading.value = false
  if (status === 404) { error.value = `${t('company.couldNotLoad')}: "${slug}"`; return }
  if (!ok) { error.value = t('company.couldNotLoad'); return }
  company.value = data
}

onMounted(() => load(route.params.slug))
watch(() => route.params.slug, (slug) => { if (slug) load(slug) })
</script>

<template>
  <div class="container mx-auto px-6 py-10 max-w-5xl">
    <p v-if="loading" class="text-sm text-muted-foreground">…</p>
    <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>
    <template v-else-if="company">

      <!-- Company header (LinkedIn-style) -->
      <div class="mb-10">

        <!-- Banner -->
        <div class="h-72 overflow-hidden rounded-2xl bg-gradient-to-br from-muted to-muted/40">
          <Image
            v-if="company.bannerImageId"
            :id="company.bannerImageId"
            :alt="company.name"
            class="h-full w-full object-cover"
          />
        </div>

        <!-- Avatar + name row, overlapping banner bottom -->
        <div class="flex items-end gap-5 pl-12 -mt-20 relative">
          <div class="size-32 rounded-2xl ring-4 ring-background shadow-sm overflow-hidden shrink-0 relative z-10">
            <Avatar :id="company.profileImageId" class="w-full h-full rounded-none">
              <span class="text-3xl font-bold text-muted-foreground">{{ company.name?.charAt(0)?.toUpperCase() }}</span>
            </Avatar>
          </div>

          <div class="flex-1 min-w-0 flex items-center justify-between pb-1">
            <h1 class="text-2xl font-bold text-foreground leading-tight">{{ company.name }}</h1>
            <Button
              v-if="company.canManage"
              variant="outline"
              size="sm"
              @click="router.push(`/c/${company.slug}/settings`)"
            >
              <Icon icon="mdi:cog" class="size-4" />
              {{ $t('nav.settings') }}
            </Button>
          </div>
        </div>

      </div>

      <ProductionList :company="company" />

    </template>
  </div>
</template>
