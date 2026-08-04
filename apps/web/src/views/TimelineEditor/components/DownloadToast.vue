<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { Icon } from '@iconify/vue'
import { useDownloadQueue } from '../useMediaDownloads.js'
import { formatBytes, dismissFinishedDownloads, dismissDownload } from '../mediaDownloads.js'

// Toast-style island for the media the editor is pulling in: a collapsed
// summary with the overall bar, expandable into a row per file. It appears on
// its own the moment anything starts loading and retires itself once the queue
// is quiet — except when something failed, which stays until dismissed, since a
// clip that never got its audio is a state the user has to know about.
const { entries, active, failed, done, progress } = useDownloadQueue()

const visible  = ref(false)
const expanded = ref(false)

const HIDE_DELAY_MS = 2400   // long enough to see the bar land on 100%
let _hideTimer = null

function cancelHide() {
  if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null }
}

function hideNow() {
  cancelHide()
  visible.value  = false
  expanded.value = false
  dismissFinishedDownloads()
}

// Retires itself once the queue is quiet — but never out from under someone
// who has the file list open, or while a failure still needs acknowledging.
function maybeScheduleHide() {
  if (!visible.value || expanded.value || _hideTimer) return
  if (active.value.length || failed.value.length) return
  _hideTimer = setTimeout(hideNow, HIDE_DELAY_MS)
}

watch(
  [() => active.value.length, () => failed.value.length, () => entries.value.length],
  ([activeCount, failedCount, total]) => {
    if (activeCount > 0 || failedCount > 0) { cancelHide(); visible.value = true; return }
    if (total === 0) { cancelHide(); visible.value = false; expanded.value = false; return }
    maybeScheduleHide()
  },
  { immediate: true },
)

function toggleExpanded() {
  expanded.value = !expanded.value
  if (expanded.value) cancelHide()
  else                maybeScheduleHide()
}

onUnmounted(cancelHide)

const state = computed(() => {
  if (active.value.length) return 'loading'
  if (failed.value.length) return 'error'
  return 'done'
})

const HEAD_ICON = { loading: 'mdi:tray-arrow-down', error: 'mdi:alert-circle-outline', done: 'mdi:check-circle-outline' }

const headline = computed(() => {
  if (state.value === 'error')   return { key: 'editor.downloads.failedTitle', args: { count: failed.value.length } }
  if (state.value === 'loading') return { key: 'editor.downloads.title',       args: {} }
  return { key: 'editor.downloads.ready', args: {} }
})

const percent = computed(() => Math.round(progress.value * 100))

const KIND_ICON = { audio: 'mdi:music-note', image: 'mdi:image-outline', file: 'mdi:file-outline' }

function rowPercent(entry) {
  if (entry.status === 'ready') return 100
  if (!entry.total) return 0
  return Math.min(100, Math.round((entry.loaded / entry.total) * 100))
}

// A download with no Content-Length yet has nothing truthful to show as a
// fraction — the bar goes indeterminate rather than sitting at a fake zero.
const isIndeterminate = (entry) => entry.status === 'downloading' && !entry.total
</script>

<template>
  <Transition
    enter-from-class="opacity-0 translate-y-3"
    enter-active-class="transition-all duration-200 ease-out"
    leave-to-class="opacity-0 translate-y-2 scale-95"
    leave-active-class="transition-all duration-150 ease-in"
  >
    <div
      v-if="visible"
      class="absolute bottom-5 right-5 z-40 w-80 max-w-[calc(100vw-2.5rem)] rounded-xl border border-border
             bg-popover/95 backdrop-blur-md shadow-2xl overflow-hidden"
    >
      <!-- Summary row — the whole strip toggles the file list -->
      <button
        type="button"
        class="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-accent/40 transition-colors"
        :title="expanded ? $t('editor.downloads.collapse') : $t('editor.downloads.expand')"
        @click="toggleExpanded"
      >
        <Icon
          :icon="HEAD_ICON[state]"
          class="size-4 shrink-0"
          :class="{
            'text-primary animate-pulse': state === 'loading',
            'text-destructive':           state === 'error',
            'text-muted-foreground':      state === 'done',
          }"
        />

        <div class="flex-1 min-w-0">
          <p class="text-xs font-semibold text-foreground truncate leading-tight">
            {{ $t(headline.key, headline.args) }}
          </p>
          <p class="text-[11px] text-muted-foreground leading-tight tabular-nums">
            {{ $t('editor.downloads.count', { done: done.length, total: entries.length }) }}
          </p>
        </div>

        <span v-if="state === 'loading'" class="text-xs font-mono text-muted-foreground tabular-nums shrink-0">
          {{ percent }}%
        </span>

        <Icon
          icon="mdi:chevron-down"
          class="size-4 text-muted-foreground shrink-0 transition-transform"
          :class="expanded ? 'rotate-180' : ''"
        />
      </button>

      <!-- Overall progress -->
      <div class="h-1 bg-muted/60">
        <div
          class="h-full transition-[width] duration-200 ease-out"
          :class="state === 'error' ? 'bg-destructive' : 'bg-primary'"
          :style="{ width: (state === 'loading' ? percent : 100) + '%' }"
        />
      </div>

      <!-- Per-file rows -->
      <div v-if="expanded" class="max-h-56 overflow-y-auto divide-y divide-border/60 border-t border-border/60">
        <div v-for="entry in entries" :key="entry.fileId" class="px-3 py-2 flex flex-col gap-1.5">
          <div class="flex items-center gap-2">
            <Icon
              :icon="KIND_ICON[entry.kind] ?? KIND_ICON.file"
              class="size-3.5 shrink-0"
              :class="entry.status === 'error' ? 'text-destructive' : 'text-muted-foreground'"
            />
            <span class="flex-1 min-w-0 text-xs text-foreground truncate">
              {{ entry.name || $t('editor.downloads.unnamed') }}
            </span>

            <span class="shrink-0 text-[10px] font-mono text-muted-foreground tabular-nums">
              <template v-if="entry.status === 'error'">{{ $t('editor.downloads.failed') }}</template>
              <template v-else-if="entry.status === 'decoding'">{{ $t('editor.downloads.decoding') }}</template>
              <template v-else-if="entry.status === 'ready'">{{ formatBytes(entry.total) }}</template>
              <template v-else-if="entry.total">{{ formatBytes(entry.loaded) }} / {{ formatBytes(entry.total) }}</template>
              <template v-else>{{ formatBytes(entry.loaded) }}</template>
            </span>

            <button
              v-if="entry.status === 'error'"
              type="button"
              class="shrink-0 -mr-1 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
              :title="$t('editor.downloads.dismiss')"
              @click="dismissDownload(entry.fileId)"
            >
              <Icon icon="mdi:close" class="size-3" />
            </button>
          </div>

          <div class="h-1 rounded-full bg-muted/70 overflow-hidden">
            <div
              v-if="isIndeterminate(entry)"
              class="h-full w-1/3 rounded-full bg-primary/70 dl-indeterminate"
            />
            <div
              v-else
              class="h-full rounded-full transition-[width] duration-200 ease-out"
              :class="entry.status === 'error' ? 'bg-destructive'
                    : entry.status === 'ready' ? 'bg-primary/50'
                    : 'bg-primary'"
              :style="{ width: (entry.status === 'decoding' ? 100 : rowPercent(entry)) + '%' }"
            />
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Sweep used while a transfer has no Content-Length to measure against. */
.dl-indeterminate { animation: dl-indeterminate 1.1s ease-in-out infinite; }
@keyframes dl-indeterminate {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}
</style>
