<script setup lang="ts">
import { onMounted } from 'vue'
import AuthenticatedBadge from '../components/ui/AuthenticatedBadge.vue'
import BreadcrumbNav from '@starling/ui/BreadcrumbNav'
import { useAuth } from '../composables/useAuth'

const { fetchUser } = useAuth()

onMounted(async () => {
  await fetchUser()
})
</script>

<template>
  <div class="relative w-full flex flex-col h-full">
    <div class="container w-full mx-auto">
      <div class="px-4 py-3 flex flex-row items-center justify-between">
        <BreadcrumbNav :home-label="$t('nav.home')" />
        <authenticated-badge />
      </div>
    </div>
    <div>
      <slot />
    </div>
  </div>
</template>
