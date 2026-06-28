<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { formatBytes } from '../../../lib/utils.js'

const props = defineProps({
  stats: { type: Object, default: null },
})

const { t } = useI18n()
const animated = ref(false)

const TYPE_CONFIG = {
  image: { color: 'oklch(0.56 0.22 255)' },
  audio: { color: 'oklch(0.68 0.20 46)' },
}

watch(() => props.stats, async (s) => {
  if (!s) return
  animated.value = false
  await nextTick()
  requestAnimationFrame(() => requestAnimationFrame(() => { animated.value = true }))
}, { immediate: true })

const barTotal = computed(() =>
  props.stats ? (props.stats.allocatedStorage ?? props.stats.usedStorage) : 0,
)

const segments = computed(() => {
  if (!props.stats || !barTotal.value) return []
  return [...props.stats.breakdown]
    .filter(b => b.size > 0)
    .sort((a, b) => b.size - a.size)
    .map(b => ({
      type:  b.type,
      size:  b.size,
      pct:   (b.size / barTotal.value) * 100,
      label: t(`storage.type.${b.type}`),
      color: TYPE_CONFIG[b.type]?.color ?? 'oklch(0.52 0.10 285)',
    }))
})

const freeSize = computed(() => {
  if (!props.stats?.allocatedStorage) return null
  return Math.max(0, props.stats.allocatedStorage - props.stats.usedStorage)
})

</script>

<template>
  <div class="rounded-xl border border-border bg-card px-5 py-5">

    <div class="flex items-baseline justify-between mb-4">
      <span class="text-sm font-medium text-foreground">{{ t('dashboard.storage') }}</span>
      <span v-if="stats?.allocatedStorage" class="text-xs text-muted-foreground">
        {{ formatBytes(stats.allocatedStorage) }} {{ t('dashboard.total') }}
      </span>
      <span v-else class="text-xs text-muted-foreground">
        <span class="font-medium text-foreground">{{ formatBytes(stats.usedStorage) }}</span>
        {{ ' ' + t('dashboard.used') }}
      </span>
    </div>

    <div class="h-[22px] w-full rounded-full overflow-hidden flex">
      <div
        v-for="seg in segments"
        :key="seg.type"
        class="h-full shrink-0 transition-[width] duration-700 ease-out"
        :style="{ width: animated ? `${seg.pct}%` : '0%', backgroundColor: seg.color }"
      />
      <div v-if="stats?.allocatedStorage" class="h-full flex-1 bg-muted min-w-0" />
    </div>

    <div v-if="stats?.allocatedStorage" class="flex justify-between mt-2">
      <span class="text-xs text-muted-foreground tabular-nums">
        {{ formatBytes(stats.usedStorage) }} {{ t('dashboard.used') }}
      </span>
      <span class="text-xs text-muted-foreground tabular-nums">
        {{ formatBytes(freeSize) }} {{ t('dashboard.free') }}
      </span>
    </div>

    <div v-if="segments.length" class="mt-5 flex flex-wrap gap-x-8 gap-y-4">
      <div v-for="seg in segments" :key="seg.type" class="flex flex-col gap-1.5">
        <div class="h-1 w-8 rounded-full" :style="{ backgroundColor: seg.color }" />
        <span class="text-xs text-muted-foreground">{{ seg.label }}</span>
        <span class="text-sm font-semibold text-foreground tabular-nums">{{ formatBytes(seg.size) }}</span>
      </div>
    </div>

    <p v-else class="mt-4 text-sm text-muted-foreground">{{ t('dashboard.noFiles') }}</p>

  </div>
</template>
