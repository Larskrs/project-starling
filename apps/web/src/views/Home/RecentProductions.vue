<script setup>
import { onMounted }         from 'vue'
import { useI18n }           from 'vue-i18n'
import { RouterLink }        from 'vue-router'
import { Avatar, Skeleton }  from '@starling/ui'
import { useRecentActivity } from '../../composables/useRecentActivity.js'
import { relativeTime }      from '../../lib/utils.js'

const { t } = useI18n()
const { productions, loading, load } = useRecentActivity()

onMounted(load)
</script>

<template>
  <!--
    A "jump back in" strip, not a listing: it stays out of the way entirely
    until the user has opened something, so a new account sees the normal home
    page rather than an empty shelf. Errors are silent for the same reason —
    the full production list below is the reliable path.
  -->
  <section v-if="loading || productions.length" class="flex flex-col gap-2.5">
    <h2 class="text-sm font-semibold">{{ $t('activity.jumpBackIn') }}</h2>

    <div class="grid gap-3 grid-cols-[repeat(auto-fill,minmax(184px,1fr))]">
      <template v-if="loading">
        <div v-for="i in 3" :key="i" class="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
          <Skeleton class="size-9 rounded-sm shrink-0" />
          <div class="flex-1 min-w-0 flex flex-col gap-1.5">
            <Skeleton class="h-3.5 w-24 rounded" />
            <Skeleton class="h-3 w-14 rounded" />
          </div>
        </div>
      </template>

      <template v-else>
        <RouterLink
          v-for="p in productions"
          :key="p.id"
          :to="`/c/${p.companySlug}/p/${p.slug}`"
          class="flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:bg-hover"
        >
          <Avatar :id="p.profileImageId" :alt="p.name" class="size-9 rounded-sm shrink-0" />
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-foreground">{{ p.name }}</p>
            <p class="truncate text-xs text-muted-foreground">{{ relativeTime(t, p.lastOpenedAt) }}</p>
          </div>
        </RouterLink>
      </template>
    </div>
  </section>
</template>
