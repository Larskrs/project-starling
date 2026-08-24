<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { SOURCE_HOTKEYS } from '../lib/editorUtils'
import SourceBadge from '../../Production/components/SourceBadge.vue'
import type { EditorTrack, Source } from '../../../types/timeline'

// Compact switcher shown while a track whose type has a source set is selected.
// Picking a source — by click or by its digit key — drops a clip at the
// playhead. It is opaque on purpose: it sits over the timeline during a live
// take, and a translucent panel with clips scrolling underneath makes the chips
// hard to read at a glance.
const props = withDefaults(defineProps<{
  track: EditorTrack
  sources?: Source[]
  /** Playhead timecode the clip lands on. */
  tc?: string
  /** Source under the playhead right now — the take currently on air. */
  activeSourceId?: string | null
  /** Briefly set after a source is picked, so a keypress visibly registers. */
  flashSourceId?: string | null
}>(), {
  sources: () => [], tc: '', activeSourceId: null, flashSourceId: null,
})

defineEmits<{ add: [source: Source]; close: [] }>()

// Only the first ten get a key — there are only ten digits. The rest stay
// clickable, and lose the keycap rather than showing a lie.
const chips = computed(() =>
  props.sources.map((source, i) => ({ source, hotkey: SOURCE_HOTKEYS[i] ?? null })),
)
</script>

<template>
  <div class="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex justify-center px-4">
    <div
      class="pointer-events-auto flex flex-col rounded-xl border border-border bg-popover shadow-lg
             overflow-hidden max-w-[min(94vw,64rem)]"
    >
      <!-- One-line header: what you're writing to, and where -->
      <div class="flex items-center gap-2.5 px-3 py-2 border-b border-border bg-muted/40">
        <span
          class="size-2.5 rounded-full shrink-0"
          :style="{ backgroundColor: `oklch(65% 0.18 ${track.typeHue ?? 250})` }"
        />
        <span class="text-sm font-semibold text-foreground truncate">{{ track.name }}</span>
        <span class="text-sm font-mono text-muted-foreground tabular-nums shrink-0">{{ tc }}</span>
        <div class="flex-1 min-w-4" />
        <button
          type="button"
          class="shrink-0 -mr-1 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          :title="$t('editor.sourceBar.close')"
          @click="$emit('close')"
        >
          <Icon icon="mdi:close" class="size-4" />
        </button>
      </div>

      <div v-if="chips.length" class="flex flex-wrap gap-1.5 p-2 max-h-56 overflow-y-auto">
        <!-- Chips are deliberately large: they're hit under time pressure, and
             the keycap has to be readable without looking straight at it. -->
        <button
          v-for="{ source, hotkey } in chips"
          :key="source.id"
          type="button"
          :title="$t('editor.sourceBar.addsAt', { tc })"
          class="flex items-center gap-2 h-11 rounded-lg border-2 pr-3 transition-all active:scale-[0.97]"
          :class="[
            hotkey ? 'pl-1.5' : 'pl-3',
            source.id === flashSourceId  ? 'border-primary bg-primary/25'
            : source.id === activeSourceId ? 'border-primary bg-primary/10'
            : 'border-border bg-background hover:bg-accent hover:border-muted-foreground/50',
          ]"
          @click="$emit('add', source)"
        >
          <kbd
            v-if="hotkey"
            class="flex items-center justify-center size-8 rounded-md border border-border bg-muted
                   text-sm font-mono font-semibold text-foreground shrink-0"
          >{{ hotkey }}</kbd>
          <SourceBadge
            :short-name="source.shortName"
            :hue="source.hue"
            :icon="source.icon ?? undefined"
            class="text-xs px-2 py-1 min-w-10"
          />
          <span class="text-sm font-medium text-foreground whitespace-nowrap">{{ source.name }}</span>
          <!-- The take on air. The border alone reads as "selected"; this says
               "this is what is going out right now". -->
          <span
            v-if="source.id === activeSourceId"
            class="size-2 rounded-full bg-primary shrink-0 ml-0.5"
            :title="$t('editor.sourceBar.onAir')"
          />
        </button>
      </div>

      <p v-else class="px-3 py-2.5 text-sm text-muted-foreground">
        {{ $t('editor.sourceBar.noSources') }}
      </p>
    </div>
  </div>
</template>
