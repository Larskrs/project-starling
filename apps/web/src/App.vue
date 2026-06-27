<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import DefaultLayout from './layouts/DefaultLayout.vue'
import DebugProvider from './providers/DebugProvider.vue'
import Toast from '@starling/ui/Toast'

const route = useRoute()

// Walk matched records from deepest to shallowest so child routes can
// override the layout, but a parent's layout is used when children omit it.
const layout = computed(() => {
  for (let i = route.matched.length - 1; i >= 0; i--) {
    const l = route.matched[i].meta?.layout
    if (l) return l
  }
  return DefaultLayout
})
</script>

<template>
  <DebugProvider>
    <component :is="layout">
      <RouterView />
    </component>
    <Toast />
  </DebugProvider>
</template>
