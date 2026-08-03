<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n }        from 'vue-i18n'
import { Icon }           from '@iconify/vue'
import { Avatar }         from '@starling/ui'
import ListCard           from '@starling/ui/ListCard'
import ListHeader         from '@starling/ui/ListHeader'
import ListItem           from '@starling/ui/ListItem'
import { useApi }         from '../../composables/useApi.js'
import { useRecentActivity } from '../../composables/useRecentActivity.js'
import { relativeTime }   from '../../lib/utils.js'
import { Skeleton }       from '@starling/ui'

const { t }      = useI18n()
const { $fetch } = useApi()

const productions = ref([])
const listLoading = ref(true)
const error       = ref('')

const { productions: recents, loading: recentsLoading, load: loadRecents } = useRecentActivity()

// Both requests go out together; the rows only render once both have settled,
// so the list never visibly reshuffles when the recents arrive late.
const loading = computed(() => listLoading.value || recentsLoading.value)

const openedAt = computed(() => new Map(recents.value.map(p => [p.id, p.lastOpenedAt])))

/** Recently opened first, then everything else newest-created first. */
const ordered = computed(() => {
  const opened = openedAt.value
  return [...productions.value].sort((a, b) => {
    const ao = opened.get(a.id)
    const bo = opened.get(b.id)
    if (ao && bo) return new Date(bo) - new Date(ao)
    if (ao) return -1
    if (bo) return 1
    return new Date(b.createdAt) - new Date(a.createdAt)
  })
})

async function load() {
  listLoading.value = true
  error.value   = ''
  const { ok, data } = await $fetch('/api/production/list', { silent: true })
  listLoading.value = false
  if (!ok) { error.value = t('production.failedToLoad'); return }
  productions.value = data
}

onMounted(() => { load(); loadRecents() })

/** "opened 2h ago" for projects you've been in, "added 3d ago" otherwise. */
function timeLabel(p) {
  const opened = openedAt.value.get(p.id)
  return opened
    ? t('production.openedAgo', { time: relativeTime(t, opened) })
    : t('production.addedAgo',  { time: relativeTime(t, p.createdAt) })
}
</script>

<template>
  <ListCard>

    <ListHeader :title="$t('production.title')" />

    <ul v-if="loading" class="divide-y divide-border">
      <li v-for="i in 4" :key="i" class="flex items-center gap-3 px-4 py-3">
        <Skeleton class="size-9 rounded-md shrink-0" />
        <div class="flex-1 min-w-0 flex flex-col gap-1.5">
          <Skeleton class="h-3.5 rounded w-32" />
          <Skeleton class="h-3 rounded w-20" />
        </div>
        <Skeleton class="h-3 rounded w-16 shrink-0" />
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
        v-for="p in ordered"
        :key="p.id"
        :to="`/c/${p.companySlug}/p/${p.slug}`"
      >
        <Avatar :id="p.profileImageId" :alt="p.name" class="size-9 rounded-md shrink-0" />

        <div class="flex-1 min-w-0 flex flex-col gap-0.5">
          <span class="text-sm font-medium text-foreground truncate">{{ p.name }}</span>
          <span class="text-xs text-muted-foreground truncate">{{ p.companyName }}</span>
        </div>

        <span class="text-xs text-muted-foreground/70 shrink-0">{{ timeLabel(p) }}</span>

      </ListItem>
    </ul>

  </ListCard>
</template>
