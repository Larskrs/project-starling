<script setup>
import { onMounted }        from 'vue'
import { useI18n }          from 'vue-i18n'
import { Icon }             from '@iconify/vue'
import ListCard             from '@starling/ui/ListCard'
import ListHeader           from '@starling/ui/ListHeader'
import ListItem             from '@starling/ui/ListItem'
import { Avatar, Skeleton } from '@starling/ui'
import { useRecentActivity } from '../../composables/useRecentActivity.js'
import { relativeTime }     from '../../lib/utils.js'

const { t } = useI18n()
const { timelines, loading, error, load } = useRecentActivity()

onMounted(load)

const editorLink = tl => `/c/${tl.companySlug}/p/${tl.productionSlug}/editor/${tl.id}`
</script>

<template>
  <ListCard>

    <ListHeader :title="$t('activity.recentTimelines')" />

    <ul v-if="loading" class="divide-y divide-border">
      <li v-for="i in 3" :key="i" class="flex items-center gap-3 px-4 py-3">
        <Skeleton class="size-8 rounded-sm shrink-0" />
        <div class="flex-1 min-w-0 flex items-baseline gap-2.5">
          <Skeleton class="h-3.5 rounded w-32" />
          <Skeleton class="h-3 rounded w-20" />
        </div>
        <Skeleton class="h-3 rounded w-12 shrink-0" />
      </li>
    </ul>

    <p v-else-if="error" class="px-5 py-4 text-sm text-destructive">{{ $t(error) }}</p>

    <div v-else-if="!timelines.length" class="flex flex-col items-center gap-2 py-12 text-center">
      <Icon icon="mdi:movie-open-play-outline" class="text-3xl text-muted-foreground/25" />
      <p class="text-sm text-muted-foreground">{{ $t('activity.noRecentTimelines') }}</p>
      <p class="text-xs text-muted-foreground/50">{{ $t('activity.noRecentTimelinesHint') }}</p>
    </div>

    <ul v-else class="divide-y divide-border">
      <ListItem v-for="tl in timelines" :key="tl.id" :to="editorLink(tl)">
        <Avatar :id="tl.profileImageId" :alt="tl.name" class="size-8 rounded-sm shrink-0">
          <Icon icon="mdi:movie-open-outline" class="text-base text-muted-foreground/60" />
        </Avatar>

        <div class="flex-1 min-w-0 flex items-baseline gap-2.5">
          <span class="text-sm font-medium text-foreground truncate">{{ tl.name }}</span>
          <span class="text-xs text-muted-foreground truncate shrink-0">{{ tl.productionName }}</span>
        </div>

        <span class="text-xs text-muted-foreground/70 tabular-nums shrink-0">
          {{ relativeTime(t, tl.lastOpenedAt) }}
        </span>
      </ListItem>
    </ul>

  </ListCard>
</template>
