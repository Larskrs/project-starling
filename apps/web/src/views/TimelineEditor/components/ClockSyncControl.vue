<script setup>
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { PopoverAnchor, PopoverContent, PopoverPortal, PopoverRoot } from 'radix-vue'
import { useI18n } from 'vue-i18n'
import { useToast } from '@starling/ui'
import { isDevicePresence } from '@starling/realtime'

/**
 * "Sync clocks": makes every client in the room — editors and devices —
 * re-measure its clock against the server before a show, and shows how each one
 * did.
 *
 * The server holds any Play while a sync runs (apps/api/src/lib/clockResync.ts),
 * so the panel also says when one is waiting. Pressing the button always starts
 * a sync; pressing it during one just opens it, because the server joins a
 * second press to the run already going.
 */
const props = defineProps({
  /** The room's latest ClockSyncStatus, or null if none has run this session. */
  status:    { type: Object,           default: null },
  connected: { type: Boolean,          default: false },
  frameRate: { type: [Number, String], default: 25 },
  /** Starts a room-wide sync; resolves to the server's ack. */
  resync:    { type: Function,         required: true },
})

const { t } = useI18n()
const toast = useToast()

const open     = ref(false)
const starting = ref(false)

const measuring = computed(() => props.status?.state === 'measuring')
const busy      = computed(() => measuring.value || starting.value)
const clients   = computed(() => props.status?.clients ?? [])
const frameMs   = computed(() => 1000 / (Number(props.frameRate) || 25))

// Good enough for a show: measured, and never more than one frame out.
const isTight = client => client.state === 'synced' && client.rtt / 2 <= frameMs.value
const margin  = client => Math.max(1, Math.round((client.rtt ?? 0) / 2))

const tightCount = computed(() => clients.value.filter(isTight).length)
const allTight   = computed(() => clients.value.length > 0 && tightCount.value === clients.value.length)

const tone = computed(() => {
  if (!props.status || measuring.value) return 'idle'
  return allTight.value ? 'good' : 'warn'
})

const buttonIcon = computed(() => {
  if (busy.value) return 'mdi:loading'
  if (tone.value === 'good') return 'mdi:clock-check-outline'
  if (tone.value === 'warn') return 'mdi:clock-alert-outline'
  return 'mdi:clock-outline'
})

const heading = computed(() => {
  if (measuring.value) return t('editor.clockSync.measuring')
  if (!props.status)   return t('editor.clockSync.button')
  return allTight.value ? t('editor.clockSync.allSynced') : t('editor.clockSync.someNotSynced')
})

async function start() {
  if (busy.value || !props.connected) return
  starting.value = true
  try {
    const ack = await props.resync()
    if (!ack?.ok) toast.error(t('editor.clockSync.failed'))
  } finally {
    starting.value = false
  }
}

function onButton() {
  open.value = true
  start()
}

function stateLabel(client) {
  switch (client.state) {
    case 'waiting':   return t('editor.clockSync.state.waiting')
    case 'synced':    return isTight(client)
      ? t('editor.clockSync.state.synced', { ms: margin(client) })
      : t('editor.clockSync.state.loose',  { ms: margin(client) })
    case 'failed':    return t('editor.clockSync.state.failed')
    case 'no-report': return t('editor.clockSync.state.noReport')
    default:          return t('editor.clockSync.state.left')
  }
}

function stateClass(client) {
  if (client.state === 'waiting' || client.state === 'left') return 'text-muted-foreground'
  if (isTight(client))           return 'text-emerald-600 dark:text-emerald-400'
  if (client.state === 'failed') return 'text-red-600 dark:text-red-400'
  return 'text-amber-600 dark:text-amber-400'
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverAnchor as-child>
      <button
        type="button"
        class="flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-medium shrink-0 transition-colors
               disabled:opacity-40 disabled:pointer-events-none"
        :class="{
          'text-muted-foreground hover:text-foreground hover:bg-accent': tone === 'idle',
          'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/25': tone === 'good',
          'bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25': tone === 'warn',
        }"
        :disabled="!connected"
        :aria-busy="busy"
        :title="$t('editor.clockSync.buttonHint')"
        @click="onButton"
      >
        <Icon :icon="buttonIcon" class="size-4" :class="{ 'animate-spin': busy }" />
        <span v-if="status && !measuring" class="tabular-nums">{{ tightCount }}/{{ clients.length }}</span>
        <span v-else>{{ $t('editor.clockSync.button') }}</span>
      </button>
    </PopoverAnchor>

    <PopoverPortal>
      <PopoverContent
        align="end"
        :side-offset="6"
        class="z-[200] w-80 rounded-lg border border-border bg-background text-foreground shadow-xl p-3 outline-none"
      >
        <div class="flex items-start gap-2">
          <Icon
            :icon="buttonIcon"
            class="size-5 shrink-0 mt-px"
            :class="{
              'animate-spin text-muted-foreground': busy,
              'text-emerald-600 dark:text-emerald-400': !busy && tone === 'good',
              'text-amber-600 dark:text-amber-400': !busy && tone === 'warn',
              'text-muted-foreground': !busy && tone === 'idle',
            }"
          />
          <div class="min-w-0">
            <p class="text-sm font-semibold leading-5">{{ heading }}</p>
            <p v-if="status" class="text-xs text-muted-foreground truncate">
              {{ $t('editor.clockSync.requestedBy', { name: status.requestedBy.name }) }}
            </p>
          </div>
        </div>

        <p v-if="!status" class="mt-2 text-xs text-muted-foreground">{{ $t('editor.clockSync.intro') }}</p>

        <p
          v-if="status?.playHeld"
          class="mt-2 flex items-center gap-1.5 rounded-md bg-amber-500/15 px-2 py-1 text-xs text-amber-700 dark:text-amber-400"
        >
          <Icon icon="mdi:timer-sand" class="size-3.5 shrink-0" />
          {{ $t('editor.clockSync.playHeld') }}
        </p>

        <ul v-if="clients.length" class="mt-2 max-h-64 overflow-y-auto divide-y divide-border">
          <li v-for="client in clients" :key="client.socketId" class="flex items-center gap-2 py-1.5 text-xs">
            <Icon
              :icon="isDevicePresence(client.id) ? 'mdi:router-wireless' : 'mdi:account-outline'"
              class="size-4 shrink-0 text-muted-foreground"
            />
            <span class="min-w-0 flex-1 truncate" :title="client.name">{{ client.name }}</span>
            <span class="shrink-0 flex items-center gap-1 tabular-nums" :class="stateClass(client)">
              <Icon v-if="client.state === 'waiting'" icon="mdi:loading" class="size-3 animate-spin" />
              {{ stateLabel(client) }}
            </span>
          </li>
        </ul>

        <div class="mt-3 flex justify-end">
          <button
            type="button"
            class="h-7 px-2.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors
                   disabled:opacity-40 disabled:pointer-events-none"
            :disabled="!connected || busy"
            @click="start"
          >
            {{ status ? $t('editor.clockSync.syncAgain') : $t('editor.clockSync.syncNow') }}
          </button>
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
