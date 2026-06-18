<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import DefaultLayout from './layouts/DefaultLayout.vue'
import DebugProvider from './providers/DebugProvider.vue'

const route = useRoute()
const layout = computed(() => route.meta.layout ?? DefaultLayout)
</script>

<template>
  <DebugProvider>
    <component :is="layout">
      <RouterView />
    </component>
  </DebugProvider>
</template>
