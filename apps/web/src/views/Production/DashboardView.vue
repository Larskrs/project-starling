<script setup>
import { ref, onMounted } from 'vue'
import { useRoute }       from 'vue-router'
import { useI18n }        from 'vue-i18n'
import { Icon }           from '@iconify/vue'
import { useApi }         from '../../composables/useApi.js'
import { formatBytes }    from '../../lib/utils.js'
import StorageCard        from './components/StorageCard.vue'
import MemberRow          from './components/MemberRow.vue'
import ListCard           from '@starling/ui/ListCard'
import ListHeader         from '@starling/ui/ListHeader'
import ListItem        from '@starling/ui/ListItem'

const route      = useRoute()
const { t }      = useI18n()
const { $fetch } = useApi()

const stats   = ref(null)
const recent  = ref(null)
const loading = ref(true)
const error   = ref('')

const FILE_ICONS = {
  image: 'mdi:image-outline',
  audio: 'mdi:music-note-outline',
}

function fileIcon(type) {
  return FILE_ICONS[type] ?? 'mdi:file-outline'
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)   return t('time.justNow')
  if (mins < 60)  return t('time.minutesAgo', { n: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return t('time.hoursAgo', { n: hrs })
  const days = Math.floor(hrs / 24)
  if (days < 7)   return t('time.daysAgo', { n: days })
  if (days < 30)  return t('time.weeksAgo', { n: Math.floor(days / 7) })
  if (days < 365) return t('time.monthsAgo', { n: Math.floor(days / 30) })
  return t('time.yearsAgo', { n: Math.floor(days / 365) })
}

function uploaderName(uploader) {
  if (!uploader) return null
  return uploader.firstName ? `${uploader.firstName} ${uploader.lastName ?? ''}`.trim() : uploader.name
}

async function load() {
  loading.value = true
  error.value   = ''
  const base = `/api/company/${route.params.cslug}/production/${route.params.pslug}`
  const [statsRes, recentRes] = await Promise.all([
    $fetch(`${base}/storage-stats`, { silent: true }),
    $fetch(`${base}/dashboard`,     { silent: true }),
  ])
  loading.value = false
  if (!statsRes.ok || !recentRes.ok) { error.value = t('dashboard.couldNotLoad'); return }
  stats.value  = statsRes.data
  recent.value = recentRes.data
}

onMounted(load)
</script>

<template>
  <div class="p-6 max-w-5xl mx-auto flex flex-col gap-6">

    <div v-if="loading" class="flex items-center gap-2 text-muted-foreground text-sm">
      <Icon icon="mdi:loading" class="animate-spin size-4" />
    </div>
    <p v-else-if="error" class="text-sm text-destructive">{{ error }}</p>

    <template v-else>
      <StorageCard v-if="stats" :stats="stats" />

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">

        <!-- Recent files -->
        <ListCard>
          <ListHeader :title="t('dashboard.recentFiles')">
            <template #action>
              <Icon icon="mdi:file-multiple-outline" class="size-4 text-muted-foreground" />
            </template>
          </ListHeader>

          <p v-if="!recent?.recentFiles?.length" class="px-5 py-10 text-center text-sm text-muted-foreground">
            {{ t('dashboard.noRecentFiles') }}
          </p>

          <ul v-else class="divide-y divide-border">
            <ListItem v-for="file in recent.recentFiles" :key="file.id">
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
              <span class="text-xs text-muted-foreground shrink-0 tabular-nums">{{ timeAgo(file.createdAt) }}</span>
            </ListItem>
          </ul>
        </ListCard>

        <!-- Recent members -->
        <ListCard>
          <ListHeader :title="t('dashboard.recentMembers')">
            <template #action>
              <Icon icon="mdi:account-group-outline" class="size-4 text-muted-foreground" />
            </template>
          </ListHeader>

          <p v-if="!recent?.recentMembers?.length" class="px-5 py-10 text-center text-sm text-muted-foreground">
            {{ t('dashboard.noRecentMembers') }}
          </p>

          <ul v-else class="divide-y divide-border">
            <MemberRow v-for="member in recent.recentMembers" :key="member.id" :member="member">
              <span
                v-if="member.role"
                class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
                :style="{ backgroundColor: `oklch(62% 0.17 ${member.role.hue} / 0.15)`, color: `oklch(52% 0.17 ${member.role.hue})` }"
              >{{ member.role.name }}</span>
              <span class="text-xs text-muted-foreground shrink-0 tabular-nums">{{ timeAgo(member.createdAt) }}</span>
            </MemberRow>
          </ul>
        </ListCard>

      </div>
    </template>

  </div>
</template>
