<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Icon } from '@iconify/vue'

const route = useRoute()

const segmentTranslations = new Map<string, string>([
  ['c', 'Produksjonshus'],
])

const crumbs = computed(() => {
  const segments = route.path.split('/').filter(Boolean)
  return segments.map((seg, i) => {
    const scoped = segments[i - 1] ? `${segments[i - 1]}/${seg}` : null
    const label =
      (scoped && segmentTranslations.get(scoped)) ??
      segmentTranslations.get(seg) ??
      seg.charAt(0).toUpperCase() + seg.slice(1)

    return {
      label,
      path: '/' + segments.slice(0, i + 1).join('/'),
      current: i === segments.length - 1,
    }
  })
})
</script>

<template>
  <nav class="flex items-center gap-1 text-sm">
    <router-link to="/home" class="text-muted-foreground hover:text-foreground transition-colors flex gap-1 items-center">
      <Icon icon="mdi:home" class="size-4" />
      <span>Hjem</span>
    </router-link>
    <template v-for="(crumb, i) in crumbs" :key="crumb.path">
      <span class="text-muted-foreground/40 select-none">/</span>
      <router-link
        v-if="!crumb.current"
        :to="crumb.path"
        class="text-muted-foreground hover:text-foreground transition-colors"
      >{{ crumb.label }}</router-link>
      <span v-else-if="crumb.path !== '/home'" class="font-medium">{{ crumb.label }}</span>
    </template>
  </nav>
</template>
