<script setup>
import { Icon } from '@iconify/vue'
import { FloatingIsland, IconButton } from '@starling/ui'
import SourceBadge from '../../Production/components/SourceBadge.vue'

// Floating island shown while a track whose type has a source set is selected.
// Clicking a source creates a clip at the playhead with that source.
defineProps({
  track:   { type: Object, required: true },
  sources: { type: Array,  default: () => [] },
  tc:      { type: String, default: '' },   // playhead timecode the clip lands on
})

defineEmits(['add', 'close'])
</script>

<template>
  <FloatingIsland class="min-w-96">
    <template #header>
      <span
        class="size-2.5 rounded-full shrink-0"
        :style="{ backgroundColor: `oklch(65% 0.18 ${track.typeHue ?? 250})` }"
      />
      <div class="min-w-0">
        <p class="text-sm font-semibold text-foreground truncate leading-tight">{{ track.name }}</p>
        <p class="text-xs text-muted-foreground leading-tight">
          {{ $t('editor.sourceBar.addsAt', { tc }) }}
        </p>
      </div>
    </template>

    <template #actions>
      <IconButton :title="$t('editor.sourceBar.close')" @click="$emit('close')">
        <Icon icon="mdi:close" class="size-4" />
      </IconButton>
    </template>

    <!-- Sources: large tap targets, wrapping grid, scrolls when the set is big -->
    <div v-if="sources.length" class="flex flex-wrap gap-2 max-h-44 overflow-y-auto">
      <button
        v-for="s in sources"
        :key="s.id"
        type="button"
        :title="$t('editor.sourceBar.hint')"
        class="group flex items-center gap-2.5 pl-2 pr-3 py-2 rounded-xl border border-border bg-background/60
               hover:bg-accent hover:border-muted-foreground/40 active:scale-[0.98] transition-all"
        @click="$emit('add', s)"
      >
        <SourceBadge :short-name="s.shortName" :hue="s.hue" class="text-sm px-2 py-1 min-w-10" />
        <span class="text-sm font-medium text-foreground whitespace-nowrap">{{ s.name }}</span>
        <Icon
          icon="mdi:plus"
          class="size-4 text-muted-foreground/50 group-hover:text-foreground transition-colors"
        />
      </button>
    </div>

    <p v-else class="text-sm text-muted-foreground py-1">
      {{ $t('editor.sourceBar.noSources') }}
    </p>
  </FloatingIsland>
</template>
