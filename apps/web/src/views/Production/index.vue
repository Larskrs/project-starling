<script setup>
import { ref, computed, provide, onMounted, watch } from 'vue'
import { useRoute, useRouter, RouterView } from 'vue-router'
import { Icon } from '@iconify/vue'
import { useAuth } from '../../composables/useAuth'

const route  = useRoute()
const router = useRouter()
const { user, logout, fetchUser } = useAuth()

// ── Data ──────────────────────────────────────────────────────────────────────
const data    = ref(null)
const loading = ref(true)
const error   = ref('')

async function load(cslug, pslug) {
  loading.value = !data.value  // only show spinner on initial load
  error.value   = ''
  try {
    const res = await fetch(`/api/company/${cslug}/production/${pslug}`, { credentials: 'include' })
    if (res.status === 404) { error.value = 'Production not found'; return }
    if (!res.ok) throw new Error()
    data.value = await res.json()
  } catch {
    error.value = 'Could not load production'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchUser()
  load(route.params.cslug, route.params.pslug)
})

// Use individual getter functions so Vue compares string values with ===.
// A single () => [a, b] always returns a new array reference, firing on every
// child-route navigation even when cslug/pslug haven't actually changed.
watch(
  [() => route.params.cslug, () => route.params.pslug],
  ([c, p], [oc, op]) => { if (c && p && (c !== oc || p !== op)) load(c, p) },
)

provide('production-data', data)

// ── Sidebar ───────────────────────────────────────────────────────────────────
const collapsed = ref(false)

const NAV = [
  { id: 'files',    label: 'Files',    icon: 'mdi:folder-outline' },
  { id: 'settings', label: 'Settings', icon: 'mdi:cog-outline' },
  { id: 'members',  label: 'Members',  icon: 'mdi:account-group-outline' },
]

const activeSection = computed(() => {
  const seg = route.path.split('/').at(-1)
  return NAV.find(n => n.id === seg)?.id ?? 'files'
})

function navigate(id) {
  router.push(`/c/${route.params.cslug}/p/${route.params.pslug}/${id}`)
}

// ── Breadcrumb ────────────────────────────────────────────────────────────────
const crumbs = computed(() => {
  const items = [
    { label: 'Hjem',    path: '/home' },
    { label: data.value?.company.name ?? route.params.cslug, path: `/c/${route.params.cslug}` },
    { label: data.value?.production.name ?? route.params.pslug, path: null },
  ]
  return items
})
</script>

<template>
  <div class="flex h-screen w-full overflow-hidden bg-background">

    <!-- Sidebar -->
    <aside
      class="flex flex-col border-r border-border bg-background transition-[width] duration-200 ease-in-out shrink-0"
      :class="collapsed ? 'w-14' : 'w-56'"
    >
      <!-- Logo / collapse toggle -->
      <div
        class="flex items-center border-b border-border"
        :class="collapsed ? 'justify-center px-0 h-14' : 'justify-between px-3 h-14'"
      >
        <router-link
          v-if="!collapsed"
          :to="`/c/${route.params.cslug}`"
          class="flex items-center gap-2 min-w-0"
        >
          <Icon icon="mdi:star-four-points" class="text-primary shrink-0 text-lg" />
          <span class="text-sm font-semibold truncate text-foreground">
            {{ data?.company.name ?? '…' }}
          </span>
        </router-link>

        <button
          class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
          @click="collapsed = !collapsed"
        >
          <Icon :icon="collapsed ? 'mdi:chevron-right' : 'mdi:chevron-left'" class="text-2xl" />
        </button>
      </div>

      <!-- Production name -->
      <div
        class="border-b border-border overflow-hidden transition-all duration-200"
        :class="collapsed ? 'px-0 py-3 flex items-center justify-center' : 'px-3 py-3'"
      >
        <template v-if="collapsed">
          <Icon icon="mdi:film" class="text-muted-foreground text-base" />
        </template>
        <template v-else>
          <p class="text-[10px] font-medium uppercase tracking-widest text-muted-foreground mb-0.5">Production</p>
          <p class="text-sm font-semibold text-foreground truncate">
            {{ data?.production.name ?? '…' }}
          </p>
          <p class="text-[11px] text-muted-foreground font-mono truncate">
            {{ data?.production.slug ?? '' }}
          </p>
        </template>
      </div>

      <!-- Nav -->
      <nav class="flex-1 py-2 flex flex-col gap-1 px-1.5 overflow-y-auto">
        <button
          v-for="item in NAV"
          :key="item.id"
          class="flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium transition-colors w-full text-left"
          :class="[
            activeSection === item.id
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50',
            collapsed ? 'justify-center' : '',
          ]"
          :title="collapsed ? item.label : undefined"
          @click="navigate(item.id)"
        >
          <Icon :icon="item.icon" class="text-xl shrink-0" :class="{'size-6': collapsed}" />
          <span v-if="!collapsed" class="truncate text-sm">{{ item.label }}</span>
        </button>
      </nav>

      <!-- User -->
      <div class="border-t border-border">
        <div
          class="flex items-center gap-2.5 px-2 py-3"
          :class="collapsed ? 'justify-center' : ''"
        >
          <div
            class="size-7 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold shrink-0"
            :title="collapsed ? (user?.first_name ?? user?.name ?? '') : undefined"
          >
            {{ (user?.first_name ?? user?.name ?? '?').charAt(0).toUpperCase() }}
          </div>
          <template v-if="!collapsed">
            <div class="flex-1 min-w-0">
              <p class="text-xs font-medium text-foreground truncate">
                {{ user?.first_name ? `${user.first_name} ${user.last_name ?? ''}`.trim() : user?.name }}
              </p>
              <p class="text-[11px] text-muted-foreground truncate">{{ user?.email }}</p>
            </div>
            <button
              class="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
              title="Log out"
              @click="logout"
            >
              <Icon icon="mdi:logout" class="text-base" />
            </button>
          </template>
        </div>
      </div>
    </aside>

    <!-- Main content -->
    <div class="flex-1 flex flex-col min-w-0 overflow-hidden">

      <!-- Top bar with breadcrumb -->
      <header class="h-14 flex items-center gap-2 px-6 border-b border-border shrink-0">
        <nav class="flex items-center gap-1 text-sm">
          <template v-for="(crumb, i) in crumbs" :key="i">
            <router-link
              v-if="crumb.path"
              :to="crumb.path"
              class="text-muted-foreground hover:text-foreground transition-colors"
            >{{ crumb.label }}</router-link>
            <span v-else class="font-medium text-foreground">{{ crumb.label }}</span>
            <span v-if="i < crumbs.length - 1" class="text-muted-foreground/40 select-none mx-1">/</span>
          </template>
        </nav>
      </header>

      <!-- Routed view -->
      <main class="flex-1 overflow-y-auto">
        <div v-if="loading" class="flex items-center justify-center h-full">
          <Icon icon="mdi:loading" class="animate-spin text-2xl text-muted-foreground/50" />
        </div>
        <p v-else-if="error" class="p-6 text-sm text-destructive">{{ error }}</p>
        <RouterView v-else-if="data" />
      </main>

    </div>
  </div>
</template>
