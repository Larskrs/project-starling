<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Skeleton } from '@starling/ui'
import { useApi } from '../../composables/useApi'
import { formatBytes } from '../../lib/utils'

/**
 * What this server is actually holding, from `GET /api/welcome` — the only
 * unauthenticated read in the API, and aggregate-only by design.
 *
 * A KPI row, not a chart: five headline numbers with no series and no history
 * to plot. Values wear text tokens; the icons carry the only colour.
 *
 * The band disappears entirely if the request fails. A visitor who can't reach
 * the API is better served by the rest of the page than by an error about
 * statistics.
 */
interface WelcomeStats {
  companies:   number
  productions: number
  timelines:   number
  tracks:      number
  clips:       number
  users:       number
  files:       number
  mediaBytes:  number
}

const { locale } = useI18n()
const { $fetch } = useApi()

const stats   = ref<WelcomeStats | null>(null)
const loading = ref(true)
const failed  = ref(false)

// `silent` on purpose: a visitor who has just arrived should not be greeted by
// an error toast about statistics. The band simply isn't there.
onMounted(async () => {
  const { ok, data } = await $fetch<WelcomeStats>('/api/welcome', { silent: true })
  loading.value = false
  if (!ok) { failed.value = true; return }
  stats.value = data
})

const localeTag = computed(() => (locale.value === 'no' ? 'nb-NO' : 'en-US'))

/** 842 · 1 284 · 12.9K — grouped while it still reads, compact once it doesn't. */
function compact(n: number): string {
  if (n < 10_000) return n.toLocaleString(localeTag.value)
  return new Intl.NumberFormat(localeTag.value, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

const tiles = computed(() => {
  const s = stats.value
  if (!s) return []
  return [
    { key: 'productions', icon: 'mdi:folder-multiple-outline',   value: compact(s.productions) },
    { key: 'timelines',   icon: 'mdi:timeline-outline',          value: compact(s.timelines) },
    { key: 'tracks',      icon: 'mdi:layers-triple-outline',     value: compact(s.tracks) },
    { key: 'clips',       icon: 'mdi:rectangle-outline',         value: compact(s.clips) },
    { key: 'media',       icon: 'mdi:database-outline',          value: formatBytes(s.mediaBytes) },
  ]
})
</script>

<template>
  <section v-if="!failed" class="rounded-2xl border border-border bg-card">
    <div class="flex items-center gap-2 px-5 py-3 text-xs font-medium text-muted-foreground">
      <span class="size-1.5 rounded-full bg-emerald-500" />
      {{ $t('welcome.stats.live') }}
    </div>

    <dl class="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-3 lg:grid-cols-5">
      <template v-if="loading">
        <div v-for="i in 5" :key="i" class="flex flex-col gap-2.5 bg-card px-5 py-5">
          <Skeleton class="h-3 w-16 rounded" />
          <Skeleton class="h-7 w-20 rounded" />
        </div>
      </template>

      <div v-for="tile in tiles" v-else :key="tile.key" class="bg-card px-5 py-5">
        <dt class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon :icon="tile.icon" class="size-4 shrink-0 text-primary" />
          {{ $t(`welcome.stats.${tile.key}`) }}
        </dt>
        <!-- Proportional figures on purpose: tabular digits read loose this large -->
        <dd class="mt-1.5 text-3xl font-semibold tracking-tight">{{ tile.value }}</dd>
      </div>
    </dl>
  </section>
</template>
