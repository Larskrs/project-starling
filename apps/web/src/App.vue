<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DefaultLayout from './layouts/DefaultLayout.vue'
import { useLocale } from './composables/useLocale'
import DebugProvider from '@starling/ui/DebugProvider'
import Toast from '@starling/ui/Toast'
import TimelineLoadingScreen from './components/TimelineLoadingScreen.vue'
import { useTimelineOpening } from './composables/useTimelineOpening'

const route  = useRoute()
const router = useRouter()
const { toggleLocale } = useLocale()
const { opening: openingTimeline } = useTimelineOpening()

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

    <Transition name="tl-loading">
      <TimelineLoadingScreen v-if="openingTimeline" :timeline="openingTimeline" />
    </Transition>
  </DebugProvider>
</template>

<style>
/* Fades out once the editor is ready; appears instantly so a slow open never
   looks like a dead click. */
.tl-loading-leave-active { transition: opacity 0.2s ease; }
.tl-loading-leave-to     { opacity: 0; }
</style>
