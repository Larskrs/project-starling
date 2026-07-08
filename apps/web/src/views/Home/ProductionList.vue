<script setup>
import { ref, onMounted } from 'vue'
import { useI18n }        from 'vue-i18n'
import { Icon }           from '@iconify/vue'
import { Avatar }         from '@starling/ui'
import ListCard           from '@starling/ui/ListCard'
import ListHeader         from '@starling/ui/ListHeader'
import ListItem        from '@starling/ui/ListItem'
import { useApi }         from '../../composables/useApi.js'
import { Skeleton }       from '@starling/ui'

const { t }      = useI18n()
const { $fetch } = useApi()

const productions = ref([])
const loading     = ref(true)
const error       = ref('')

async function load() {
  loading.value = true
  error.value   = ''
  const { ok, data } = await $fetch('/api/production/list', { silent: true })
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
</script>

<template>
  <ListCard>

    <ListHeader :title="$t('production.title')" />

    <ul v-if="loading" class="divide-y divide-border">
      <li v-for="i in 4" :key="i" class="flex items-center gap-3 px-4 py-3">
        <Skeleton class="size-8 rounded-sm shrink-0" />
        <div class="flex-1 min-w-0 flex items-baseline gap-2.5">
          <Skeleton class="h-3.5 rounded w-28" />
          <Skeleton class="h-3 rounded w-16" />
        </div>
        <Skeleton class="h-3 rounded w-12 shrink-0" />
      </li>
    </ul>

    <p v-else-if="error" class="px-5 py-4 text-sm text-destructive">{{ error }}</p>

    <div v-else-if="!productions.length" class="flex flex-col items-center gap-2 py-16 text-center">
      <Icon icon="mdi:clapperboard-outline" class="text-3xl text-muted-foreground/25" />
      <p class="text-sm text-muted-foreground">{{ $t('production.noProductions') }}</p>
      <p class="text-xs text-muted-foreground/50">{{ $t('production.noProductionsHint') }}</p>
    </div>

    <ul v-else class="divide-y divide-border">
      <ListItem
        v-for="p in productions"
        :key="p.id"
        :to="`/c/${p.companySlug}/p/${p.slug}`"
      >
        <Avatar :id="p.profileImageId" class="size-8 rounded-sm shrink-0" />

        <div class="flex-1 min-w-0 flex items-baseline gap-2.5">
          <span class="text-sm font-medium text-foreground truncate">{{ p.name }}</span>
          <span class="text-xs text-muted-foreground truncate shrink-0">{{ p.companyName }}</span>
        </div>

        <span class="text-xs text-muted-foreground/70 tabular-nums shrink-0">{{ relativeDate(p.createdAt) }}</span>

      </ListItem>
    </ul>

  </ListCard>
</template>
