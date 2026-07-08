<script setup>
import { ref, computed, provide, onMounted, watch } from 'vue'
import { usePageTitle } from '../../composables/usePageTitle.js'
import { Skeleton } from '@starling/ui'
import { useRoute, useRouter, RouterView } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { useAuth } from '../../composables/useAuth'
import { useColorMode } from '../../composables/useColorMode'
import { useLocale } from '../../composables/useLocale'
import { useApi } from '../../composables/useApi.js'
import Avatar from '@starling/ui/Avatar'
import BreadcrumbNav from '@starling/ui/BreadcrumbNav'

const route  = useRoute()
const router = useRouter()
const { user, logout, fetchUser } = useAuth()
const { isDark, toggle: toggleColorMode } = useColorMode()
const { locale, toggleLocale } = useLocale()
const { t } = useI18n()
const { $fetch } = useApi()

// ── Data ──────────────────────────────────────────────────────────────────────
const data    = ref(null)
const loading = ref(true)
const error   = ref('')

async function load(cslug, pslug) {
  loading.value = !data.value
  error.value   = ''
  const { ok, data: resData, status } = await $fetch(
    `/api/production/find?cslug=${encodeURIComponent(cslug)}&pslug=${encodeURIComponent(pslug)}`,
    { silent: true },
  )
  loading.value = false
  if (status === 404) { error.value = t('production.notFound'); return }
  if (status === 403) { error.value = t('production.noAccess'); return }
  if (!ok) { error.value = t('production.couldNotLoadProd'); return }
  data.value = resData
}

onMounted(() => {
  fetchUser()
  load(route.params.cslug, route.params.pslug)
})

watch(
  [() => route.params.cslug, () => route.params.pslug],
  ([c, p], [oc, op]) => { if (c && p && (c !== oc || p !== op)) load(c, p) },
)

provide('production-data', data)

// ── Sidebar ───────────────────────────────────────────────────────────────────
const SIDEBAR_KEY = 'starling-sidebar-collapsed'
const collapsed = ref(localStorage.getItem(SIDEBAR_KEY) === 'true')
watch(collapsed, v => localStorage.setItem(SIDEBAR_KEY, String(v)))

const NAV_GROUPS = [
  {
    key: 'workspace',
    label: 'nav.workspace',
    items: [
      { id: 'dashboard', icon: 'mdi:view-dashboard-outline', label: 'nav.dashboard', permission: null },
      { id: 'timelines',   icon: 'mdi:timeline-outline',       label: 'nav.timelines',  permission: null  },
      { id: 'files',     icon: 'mdi:folder-outline',          label: 'nav.files',    permission: null },
    ],
  },
  {
    key: 'management',
    label: 'nav.management',
    items: [
      { id: 'members',     icon: 'mdi:account-group-outline',  label: 'nav.members',    permission: 'MANAGE_MEMBERS' },
      { id: 'roles',       icon: 'mdi:shield-account-outline', label: 'nav.roles',      permission: 'MANAGE_ROLES'   },
    ],
  },
  {
    key: 'configuration',
    label: 'nav.configuration',
    items: [
      { id: 'track-types', icon: 'mdi:music-note-outline',     label: 'nav.trackTypes', permission: 'ADMINISTRATOR'  },
      { id: 'source-sets', icon: 'mdi:layers-outline',         label: 'nav.sourceSets', permission: 'ADMINISTRATOR'  },
      { id: 'settings', icon: 'mdi:cog-outline', label: 'nav.settings', permission: 'ADMINISTRATOR' },
    ],
  },
]

function can(permission) {
  if (!permission) return true
  if (!data.value?.access) return false
  if (data.value.access.privileged) return true
  return data.value.access.permissions.includes(permission)
}

const ALL_IDS = NAV_GROUPS.flatMap(g => g.items.map(i => i.id))

const activeSection = computed(() => {
  const segs = route.path.split('/')
  const last = segs.at(-1)
  if (ALL_IDS.includes(last)) return last
  // Handle nested routes (e.g. source-sets/:setId — parent segment is the nav id)
  const parent = segs.at(-2)
  if (parent && ALL_IDS.includes(parent)) return parent
  return 'dashboard'
})

const sectionLabel = computed(() => {
  const item = NAV_GROUPS.flatMap(g => g.items).find(i => i.id === activeSection.value)
  return item ? t(item.label) : activeSection.value
})

usePageTitle(computed(() =>
  data.value?.production?.name ? `${data.value.production.name} — ${sectionLabel.value}` : null,
))

function navigate(id) {
  router.push(`/c/${route.params.cslug}/p/${route.params.pslug}/${id}`)
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────
const crumbs = computed(() => [
  { label: t('nav.home'),                                                   path: '/home',                      icon: 'mdi:home' },
  { label: data.value?.company.name    ?? route.params.cslug,              path: `/c/${route.params.cslug}` },
  { label: data.value?.production.name ?? route.params.pslug,              path: null,                         current: true },
])
</script>

<template>
  <div class="flex h-dvh w-full overflow-hidden bg-background">

    <!-- Sidebar -->
    <aside
      class="flex flex-col border-r border-border bg-background duration-400 transition-[width] ease-in-out shrink-0"
      :class="collapsed ? 'w-14' : 'w-64'"
    >
      <!-- Logo / collapse toggle -->
      <div
        class="flex items-center border-b border-border"
        :class="collapsed ? 'justify-center px-0 h-14' : 'justify-between px-3 h-14'"
      >
        <Transition name="fade">
          <router-link
            v-if="!collapsed"
            :to="`/c/${route.params.cslug}`"
            class="flex items-center gap-2 min-w-0"
          >
            <Avatar :id="data?.production.profileImageId" class="size-8 min-w-8 rounded-sm" quality="25"  />
            <div class="flex flex-col gap-1 min-w-0">
              <template v-if="data">
                <span class="text-sm font-semibold truncate text-foreground">{{ data.production.name }}</span>
                <span class="text-[10px] text-muted-foreground/50">{{ data.company.name }}</span>
              </template>
              <template v-else>
                <Skeleton class="h-3.5 w-24 rounded" />
                <Skeleton class="h-2.5 w-16 rounded" />
              </template>
            </div>
          </router-link>
        </Transition>

        <button
          class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
          :title="collapsed ? $t('nav.expandSidebar') : $t('nav.collapseSidebar')"
          @click="collapsed = !collapsed"
        >
          <Icon :icon="collapsed ? 'mdi:chevron-right' : 'mdi:chevron-left'" class="size-4" />
        </button>
      </div>

      <!-- Nav -->
      <nav class="flex-1 py-2 px-2 flex flex-col overflow-y-auto">
        <template v-for="(group, gi) in NAV_GROUPS" :key="group.key">
          <template v-if="group.items.some(item => can(item.permission))">
            <!-- Separator + group label -->
            <div v-if="gi > 0" class="h-px bg-border mx-1 my-2" />
            <Transition name="fade">
              <p
                v-if="!collapsed"
                class="px-2.5 pt-0.5 pb-1.5 text-[12px] tracking-wider text-muted-foreground select-none"
              >
                {{ $t(group.label) }}
              </p>
            </Transition>

            <!-- Items -->
            <button
              v-for="item in group.items.filter(i => can(i.permission))"
              :key="item.id"
              class="flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm transition-colors w-full"
              :class="[
                activeSection === item.id
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                collapsed ? 'justify-center' : '',
              ]"
              :title="collapsed ? $t(item.label) : undefined"
              @click="navigate(item.id)"
            >
              <Icon :icon="item.icon" class="size-5 shrink-0" />
              <Transition name="fade">
                <span v-if="!collapsed" class="truncate">{{ $t(item.label) }}</span>
              </Transition>
            </button>
          </template>
        </template>
      </nav>

      <!-- User -->
      <div class="border-t border-border p-2">
        <div
          class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors group"
          :class="collapsed ? 'justify-center' : ''"
        >
          <Avatar :id="user?.avatarImageId" class="size-8 rounded-full shrink-0" quality="25">
            <span class="text-sm font-bold text-muted-foreground">{{ user?.name?.charAt(0)?.toUpperCase() }}</span>
          </Avatar>
          <Transition name="fade">
            <div v-if="!collapsed" class="flex-1 min-w-0 flex items-center gap-0.5">
              <div class="flex-1 min-w-0">
                <p class="text-xs font-medium text-foreground truncate leading-tight">
                  {{ user?.first_name ? `${user.first_name}`.trim() : user?.name }}
                </p>
                <p class="text-[11px] text-muted-foreground truncate leading-tight">{{ user?.email }}</p>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </aside>

    <!-- Main content -->
    <div class="flex-1 flex flex-col min-w-0 overflow-hidden">

      <!-- Top bar with breadcrumb -->
      <header class="h-14 flex items-center gap-2 px-6 border-b border-border shrink-0">
        <BreadcrumbNav :items="crumbs" />
      </header>

      <!-- Routed view -->
      <main class="flex-1 overflow-y-auto">
        <div v-if="loading" class="p-6 max-w-5xl mx-auto flex flex-col gap-6">
          <Skeleton class="h-36 rounded-xl" />
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div v-for="col in 2" :key="col" class="rounded-xl border border-border overflow-hidden">
              <div class="flex items-center px-5 py-3.5 border-b border-border">
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
        </div>
        <p v-else-if="error" class="p-6 text-sm text-destructive">{{ error }}</p>
        <RouterView v-else-if="data" />
      </main>

    </div>
  </div>
</template>

<style scoped>
.fade-leave-active {
  transition: opacity 120ms ease;
}
.fade-enter-active {
  transition: opacity 80ms ease 130ms;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
