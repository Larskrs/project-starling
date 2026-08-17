<script setup>
import { ref, computed, inject, onMounted } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { useI18n }        from 'vue-i18n'
import { Icon }           from '@iconify/vue'
import { Avatar, Skeleton } from '@starling/ui'
import { useApi }         from '../../composables/useApi'
import { useTimelineOpening } from '../../composables/useTimelineOpening'
import { formatBytes, relativeTime, timelineDuration } from '../../lib/utils'
import StorageCard        from './components/StorageCard.vue'
import MemberRow          from './components/MemberRow.vue'
import ListCard           from '@starling/ui/ListCard'
import ListHeader         from '@starling/ui/ListHeader'
import ListItem           from '@starling/ui/ListItem'

const { t }      = useI18n()
const route      = useRoute()
const router     = useRouter()
const production = inject('production-data')
const { $fetch } = useApi()
const { startOpening } = useTimelineOpening()

const stats    = ref(null)
const overview = ref(null)
const loading  = ref(true)
const error    = ref('')

const FILE_ICONS = {
  image: 'mdi:image-outline',
  audio: 'mdi:music-note-outline',
}

function fileIcon(type) {
  return FILE_ICONS[type] ?? 'mdi:file-outline'
}

function uploaderName(uploader) {
  if (!uploader) return null
  return uploader.firstName ? `${uploader.firstName} ${uploader.lastName ?? ''}`.trim() : uploader.name
}

const productionPath = computed(() => `/c/${route.params.cslug}/p/${route.params.pslug}`)

// The scale of the production in one line. Counts come from the server because
// the lists below are capped — deriving them here would under-report.
const statTiles = computed(() => {
  const counts = overview.value?.counts
  if (!counts) return []
  return [
    {
      key:   'timelines',
      icon:  'mdi:movie-open-outline',
      label: t('timelines.title'),
      value: counts.timelines.toLocaleString(),
      to:    `${productionPath.value}/timelines`,
    },
    {
      key:   'members',
      icon:  'mdi:account-group-outline',
      label: t('members.title'),
      value: counts.members.toLocaleString(),
      to:    `${productionPath.value}/members`,
    },
    {
      key:   'files',
      icon:  'mdi:file-multiple-outline',
      label: t('storage.files'),
      value: counts.files.toLocaleString(),
      to:    `${productionPath.value}/files`,
    },
    {
      key:   'storage',
      icon:  'mdi:database-outline',
      label: t('dashboard.storageUsed'),
      value: formatBytes(stats.value?.usedStorage),
    },
  ]
})

function openEditor(tl) {
  // Names the loading screen before the route even starts resolving.
  startOpening(tl)
  router.push(`${productionPath.value}/editor/${tl.id}`)
}

async function load() {
  loading.value = true
  error.value   = ''
  const base = `/api/production/${production.value?.production?.id}`
  const [statsRes, overviewRes] = await Promise.all([
    $fetch(`${base}/storage-stats`, { silent: true }),
    $fetch(`${base}/dashboard`,     { silent: true }),
  ])
  loading.value = false
  if (!statsRes.ok || !overviewRes.ok) { error.value = t('dashboard.couldNotLoad'); return }
  stats.value    = statsRes.data
  overview.value = overviewRes.data
}

onMounted(load)
</script>

<template>
  <div class="p-6 max-w-5xl mx-auto flex flex-col gap-6">

    <template v-if="loading">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Skeleton v-for="i in 4" :key="i" class="h-[62px] rounded-xl" />
      </div>
      <Skeleton class="h-36 rounded-xl" />
      <div class="rounded-xl border border-border overflow-hidden">
        <div class="px-5 py-3.5 border-b border-border">
          <Skeleton class="h-4 w-28 rounded" />
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-px bg-border">
          <div v-for="i in 4" :key="i" class="flex items-center gap-3 bg-card px-4 py-3">
            <Skeleton class="size-11 rounded-lg shrink-0" />
            <div class="flex-1 flex flex-col gap-1.5">
              <Skeleton class="h-3.5 w-3/4 rounded" />
              <Skeleton class="h-2.5 w-1/2 rounded" />
            </div>
          </div>
        </div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div v-for="col in 2" :key="col" class="rounded-xl border border-border overflow-hidden">
          <div class="flex items-center justify-between px-5 py-3.5 border-b border-border">
            <Skeleton class="h-4 w-28 rounded" />
          </div>
          <ul class="divide-y divide-border">
            <li v-for="i in 4" :key="i" class="flex items-center gap-3 px-5 py-3">
              <Skeleton class="size-8 rounded-lg shrink-0" />
              <div class="flex-1 flex flex-col gap-1.5">
                <Skeleton class="h-3.5 w-3/4 rounded" />
                <Skeleton class="h-2.5 w-1/2 rounded" />
              </div>
            </li>
          </ul>
        </div>
      </div>
    </template>
    <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>

    <template v-else>

      <!-- Scale of the production, and a way straight to each section -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <component
          :is="tile.to ? RouterLink : 'div'"
          v-for="tile in statTiles"
          :key="tile.key"
          :to="tile.to || undefined"
          class="rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-3 transition-colors"
          :class="tile.to ? 'hover:bg-hover' : ''"
        >
          <Icon :icon="tile.icon" class="size-5 shrink-0 text-muted-foreground" />
          <div class="min-w-0">
            <p class="text-lg font-semibold text-foreground tabular-nums leading-tight">{{ tile.value }}</p>
            <p class="text-xs text-muted-foreground truncate">{{ tile.label }}</p>
          </div>
        </component>
      </div>

      <StorageCard v-if="stats" :stats="stats" />

      <!-- Timelines: the production's actual work, so it leads the lists and
           opens the editor on click rather than routing to a detail page. -->
      <ListCard>
        <ListHeader :title="t('timelines.title')">
          <template #action>
            <RouterLink
              :to="`${productionPath}/timelines`"
              class="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >{{ t('dashboard.viewAll') }}</RouterLink>
          </template>
        </ListHeader>

        <p v-if="!overview?.timelines?.length" class="px-5 py-10 text-center text-sm text-muted-foreground">
          {{ t('timelines.noTimelines') }}
        </p>

        <!-- gap-px over the border colour gives the tiles hairline dividers,
             matching the divide-y lists below at two columns. -->
        <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-px bg-border">
          <button
            v-for="tl in overview.timelines"
            :key="tl.id"
            type="button"
            class="group flex items-center gap-3 bg-card px-4 py-3 text-left transition-colors hover:bg-hover"
            :title="t('timelines.openEditor')"
            @click="openEditor(tl)"
          >
            <Avatar :id="tl.profileImageId" :alt="tl.name" class="size-11 rounded-lg shrink-0">
              <Icon icon="mdi:movie-open-outline" class="size-5 text-muted-foreground/60" />
            </Avatar>

            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-foreground truncate">{{ tl.name }}</p>
              <p class="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span class="tabular-nums">{{ timelineDuration(tl) }}</span>
                <span class="text-muted-foreground/40" aria-hidden="true">·</span>
                <span>{{ tl.frameRate }} fps</span>
                <span class="text-muted-foreground/40" aria-hidden="true">·</span>
                <span class="tabular-nums">{{ tl.trackCount }} {{ t('dashboard.tracks') }}</span>
              </p>
            </div>

            <Icon
              icon="mdi:arrow-right"
              class="size-5 shrink-0 text-muted-foreground/0 transition-all duration-150
                     group-hover:text-muted-foreground/70 group-hover:translate-x-0.5"
            />
          </button>
        </div>
      </ListCard>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">

        <!-- Recent files -->
        <ListCard>
          <ListHeader :title="t('dashboard.recentFiles')">
            <template #action>
              <RouterLink
                :to="`${productionPath}/files`"
                class="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >{{ t('dashboard.viewAll') }}</RouterLink>
            </template>
          </ListHeader>

          <p v-if="!overview?.recentFiles?.length" class="px-5 py-10 text-center text-sm text-muted-foreground">
            {{ t('dashboard.noRecentFiles') }}
          </p>

          <ul v-else class="divide-y divide-border">
            <ListItem v-for="file in overview.recentFiles" :key="file.id">
              <div class="size-8 rounded-lg bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
                <Icon :icon="fileIcon(file.type)" class="size-4" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-foreground truncate">{{ file.name }}</p>
                <p class="text-xs text-muted-foreground">
                  {{ formatBytes(file.size) }}
                  <template v-if="uploaderName(file.uploader)">
                    · {{ t('dashboard.uploadedBy', { name: uploaderName(file.uploader) }) }}
                  </template>
                </p>
              </div>
              <span class="text-xs text-muted-foreground shrink-0 tabular-nums">
                {{ relativeTime(t, file.createdAt) }}
              </span>
            </ListItem>
          </ul>
        </ListCard>

        <!-- Recent members -->
        <ListCard>
          <ListHeader :title="t('dashboard.recentMembers')">
            <template #action>
              <RouterLink
                :to="`${productionPath}/members`"
                class="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >{{ t('dashboard.viewAll') }}</RouterLink>
            </template>
          </ListHeader>

          <p v-if="!overview?.recentMembers?.length" class="px-5 py-10 text-center text-sm text-muted-foreground">
            {{ t('dashboard.noRecentMembers') }}
          </p>

          <ul v-else class="divide-y divide-border">
            <MemberRow v-for="member in overview.recentMembers" :key="member.id" :member="member">
              <span
                v-if="member.role"
                class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
                :style="{ backgroundColor: `oklch(62% 0.17 ${member.role.hue} / 0.15)`, color: `oklch(52% 0.17 ${member.role.hue})` }"
              >{{ member.role.name }}</span>
              <span class="text-xs text-muted-foreground shrink-0 tabular-nums">
                {{ relativeTime(t, member.createdAt) }}
              </span>
            </MemberRow>
          </ul>
        </ListCard>

      </div>
    </template>

  </div>
</template>
