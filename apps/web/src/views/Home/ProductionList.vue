<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { useApi } from '../../composables/useApi.js'

const { t } = useI18n()
const { $fetch } = useApi()

const productions = ref([])
const loading     = ref(true)
const error       = ref('')

async function load() {
  loading.value = true
  error.value   = ''
  const { ok, data } = await $fetch('/api/production', { silent: true })
  loading.value = false
  if (!ok) { error.value = t('production.failedToLoad'); return }
  productions.value = data
}

onMounted(load)

function relativeDate(iso) {
  const diff  = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days  = Math.floor(hours / 24)
  if (mins  < 1)   return t('time.justNow')
  if (mins  < 60)  return t('time.minutesAgo', { n: mins })
  if (hours < 24)  return t('time.hoursAgo',   { n: hours })
  if (days  < 7)   return t('time.daysAgo',    { n: days })
  if (days  < 30)  return t('time.weeksAgo',   { n: Math.floor(days / 7) })
  if (days  < 365) return t('time.monthsAgo',  { n: Math.floor(days / 30) })
  return t('time.yearsAgo', { n: Math.floor(days / 365) })
}

function companyColor(slug) {
  let h = 0
  for (const ch of (slug || '')) h = (h * 31 + ch.charCodeAt(0)) & 0x7fffffff
  return `oklch(62% 0.17 ${h % 360})`
}
</script>

<template>
  <section class="rounded-xl border border-border bg-card overflow-hidden">

    <div class="flex items-center justify-between px-5 py-3.5 border-b border-border">
      <h2 class="text-sm font-semibold">{{ $t('production.title') }}</h2>
      <span
        v-if="!loading && productions.length"
        class="text-xs tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md"
      >{{ productions.length }}</span>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-16 text-muted-foreground">
      <Icon icon="mdi:loading" class="animate-spin text-xl" />
    </div>

    <div v-else-if="error" class="px-5 py-4 text-sm text-destructive">{{ error }}</div>

    <div v-else-if="!productions.length" class="flex flex-col items-center gap-2 py-16 text-center">
      <Icon icon="mdi:clapperboard-outline" class="text-3xl text-muted-foreground/25" />
      <p class="text-sm text-muted-foreground">{{ $t('production.noProductions') }}</p>
      <p class="text-xs text-muted-foreground/50">{{ $t('production.noProductionsHint') }}</p>
    </div>

    <ul v-else class="divide-y divide-border">
      <li v-for="p in productions" :key="p.id">
        <router-link
          :to="`/c/${p.companySlug}/p/${p.slug}`"
          class="group flex items-center gap-4 px-5 py-3.5 hover:bg-muted/40 transition-colors"
        >
          <span
            class="size-2 rounded-full shrink-0 mt-px"
            :style="{ backgroundColor: companyColor(p.companySlug) }"
          />

          <div class="flex-1 min-w-0 flex items-baseline gap-2.5">
            <span class="text-sm font-medium text-foreground truncate">{{ p.name }}</span>
            <span class="text-xs text-muted-foreground truncate shrink-0">{{ p.companyName }}</span>
          </div>

          <span class="text-xs text-muted-foreground/70 tabular-nums shrink-0">{{ relativeDate(p.createdAt) }}</span>

          <Icon
            icon="mdi:arrow-right"
            class="text-sm text-muted-foreground/20 group-hover:text-muted-foreground/60 shrink-0 transition-colors"
          />
        </router-link>
      </li>
    </ul>

  </section>
</template>
