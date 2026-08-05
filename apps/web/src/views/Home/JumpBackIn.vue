<script setup>
import { onMounted }         from 'vue'
import { useI18n }           from 'vue-i18n'
import { RouterLink }        from 'vue-router'
import { Icon }              from '@iconify/vue'
import { Avatar, Skeleton }  from '@starling/ui'
import { useRecentActivity } from '../../composables/useRecentActivity'
import { useTimelineOpening } from '../../composables/useTimelineOpening'
import { relativeTime }      from '../../lib/utils'

const { t } = useI18n()
const { timelines, loading, load } = useRecentActivity()
const { startOpening } = useTimelineOpening()

onMounted(load)

const editorLink = tl => `/c/${tl.companySlug}/p/${tl.productionSlug}/editor/${tl.id}`
</script>

<template>
  <!--
    Recently opened timelines — the actual work surface, so they lead the page
    as cards rather than a list row. Recently opened *projects* aren't repeated
    here: they float to the top of the project list below, which keeps one list
    per thing instead of two views of the same productions.

    The section stays out of the way entirely until there is something to jump
    back into, so a new account sees a normal page, not an empty shelf. Errors
    are silent for the same reason — the lists below are the reliable path.
  -->
  <section v-if="loading || timelines.length" class="flex flex-col gap-3">
    <h2 class="text-sm font-semibold">{{ $t('activity.jumpBackIn') }}</h2>

    <div class="grid gap-3 grid-cols-[repeat(auto-fill,minmax(232px,1fr))]">
      <template v-if="loading">
        <div v-for="i in 3" :key="i" class="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
          <Skeleton class="size-11 rounded-lg shrink-0" />
          <div class="flex-1 min-w-0 flex flex-col gap-1.5">
            <Skeleton class="h-3.5 w-28 rounded" />
            <Skeleton class="h-3 w-20 rounded" />
          </div>
        </div>
      </template>

      <template v-else>
        <RouterLink
          v-for="tl in timelines"
          :key="tl.id"
          :to="editorLink(tl)"
          class="group flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-hover"
          @click="startOpening(tl)"
        >
          <Avatar :id="tl.profileImageId" :alt="tl.name" class="size-11 rounded-lg shrink-0">
            <Icon icon="mdi:movie-open-outline" class="size-5 text-muted-foreground/60" />
          </Avatar>

          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-foreground">{{ tl.name }}</p>
            <p class="truncate text-xs text-muted-foreground">{{ tl.productionName }}</p>
            <p class="truncate text-xs text-muted-foreground/60">{{ relativeTime(t, tl.lastOpenedAt) }}</p>
          </div>

          <Icon
            icon="mdi:arrow-right"
            class="size-4 shrink-0 text-muted-foreground/0 transition-all duration-150
                   group-hover:text-muted-foreground/70 group-hover:translate-x-0.5"
          />
        </RouterLink>
      </template>
    </div>
  </section>
</template>
