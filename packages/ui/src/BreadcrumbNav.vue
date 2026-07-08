<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Icon } from '@iconify/vue'
import Breadcrumb from './Breadcrumb.vue'

interface CrumbItem {
  label:    string
  path?:    string | null
  icon?:    string | null
  current?: boolean
}

const props = withDefaults(defineProps<{
  homeLabel?: string
  items?:     CrumbItem[]
}>(), {
  homeLabel: 'Home',
  items:     undefined,
})

const route = useRoute()

const skipSegments = new Set(['home', 'c', 'p'])
const resolvedNames = ref<Record<string, string>>({})

async function resolveCompany(slug: string) {
  const key = `company:${slug}`
  if (resolvedNames.value[key]) return
  const res = await fetch(`/api/companies/${slug}`, { credentials: 'include' }).catch(() => null)
  if (res?.ok) {
    const data = await res.json().catch(() => null)
    if (data?.name) resolvedNames.value = { ...resolvedNames.value, [key]: data.name }
  }
}

watch(
  () => route.params,
  (params) => {
    if (params.slug)  resolveCompany(params.slug as string)
    if (params.cslug) resolveCompany(params.cslug as string)
  },
  { immediate: true },
)

const resolvedItems = computed(() => {
  if (props.items) {
    return props.items.map(item => ({
      label:   item.label,
      path:    item.path   ?? null,
      icon:    item.icon   ?? null,
      current: item.current ?? (item.path == null),
    }))
  }

  const segments = route.path.split('/').filter(Boolean)
  const crumbs: CrumbItem[] = []

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (skipSegments.has(seg)) continue

    const prev = segments[i - 1]
    const label = prev === 'c'
      ? (resolvedNames.value[`company:${seg}`] ?? seg.charAt(0).toUpperCase() + seg.slice(1))
      : seg.charAt(0).toUpperCase() + seg.slice(1)

    crumbs.push({
      label,
      path:    '/' + segments.slice(0, i + 1).join('/'),
      icon:    null,
      current: i === segments.length - 1,
    })
  }

  const isHome = segments.length === 0 || segments[0] === 'home'
  return [
    { label: props.homeLabel, path: '/home', icon: 'mdi:home', current: isHome },
    ...crumbs,
  ]
})
</script>

<template>
  <Breadcrumb :items="resolvedItems" class="gap-2">
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
