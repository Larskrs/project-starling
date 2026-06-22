<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Icon } from '@iconify/vue'
import Breadcrumb from './Breadcrumb.vue'

const route = useRoute()

const segmentTranslations = new Map<string, string>([
  ['c', 'Produksjonshus'],
  ['p', 'Produksjon'],
])

const items = computed(() => {
  const segments = route.path.split('/').filter(Boolean)
  const routeCrumbs = segments.map((seg, i) => {
    const scoped = segments[i - 1] ? `${segments[i - 1]}/${seg}` : null
    const label =
      (scoped && segmentTranslations.get(scoped)) ??
      segmentTranslations.get(seg) ??
      seg.charAt(0).toUpperCase() + seg.slice(1)
    return {
      label,
      path: '/' + segments.slice(0, i + 1).join('/'),
      icon:    null as string | null,
      current: i === segments.length - 1,
    }
  })
  return [
    { label: 'Hjem', path: '/home', icon: 'mdi:home', current: segments.length === 0 },
    ...routeCrumbs,
  ]
})
</script>

<template>
  <Breadcrumb :items="items">
    <template #separator>
      <span class="text-muted-foreground/40 select-none">/</span>
    </template>
    <template #default="{ item }">
      <router-link
        v-if="!item.current"
        :to="item.path"
        class="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
      >
        <Icon v-if="item.icon" :icon="item.icon" class="size-4" />
        <span>{{ item.label }}</span>
      </router-link>
      <span v-else-if="item.path !== '/home'" class="font-medium flex items-center gap-1">
        <Icon v-if="item.icon" :icon="item.icon" class="size-4" />
        {{ item.label }}
      </span>
    </template>
  </Breadcrumb>
</template>
