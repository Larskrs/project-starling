<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DefaultLayout from './layouts/DefaultLayout.vue'
import { useLocale } from './composables/useLocale.js'
import DebugProvider from '@starling/ui/DebugProvider'
import Toast from '@starling/ui/Toast'

const route  = useRoute()
const router = useRouter()
const { toggleLocale } = useLocale()

const debugRoutes = router.getRoutes()
  .filter(r => !r.redirect && r.path !== '/:pathMatch(.*)*')
  .map(r => r.path)

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
  <DebugProvider
    :routes="debugRoutes"
    :current="route.path"
    :navigate="path => router.push(path)"
    :toggle-locale="toggleLocale"
    settings-path="/debug"
  >
    <component :is="layout">
      <RouterView />
    </component>
    <Toast />
  </DebugProvider>
</template>
