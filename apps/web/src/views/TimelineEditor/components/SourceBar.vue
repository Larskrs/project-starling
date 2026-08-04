<script setup>
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { SOURCE_HOTKEYS } from '../useEditorUtils.js'
import SourceBadge from '../../Production/components/SourceBadge.vue'

// Compact switcher shown while a track whose type has a source set is selected.
// Picking a source — by click or by its digit key — drops a clip at the
// playhead. It is opaque on purpose: it sits over the timeline during a live
// take, and a translucent panel with clips scrolling underneath makes the chips
// hard to read at a glance.
const props = defineProps({
  track:          { type: Object, required: true },
  sources:        { type: Array,  default: () => [] },
  tc:             { type: String, default: '' },   // playhead timecode the clip lands on
  /** Source under the playhead right now — the take currently on air. */
  activeSourceId: { type: String, default: null },
  /** Briefly set after a source is picked, so a keypress visibly registers. */
  flashSourceId:  { type: String, default: null },
})

defineEmits(['add', 'close'])

// Only the first ten get a key — there are only ten digits. The rest stay
// clickable, and lose the keycap rather than showing a lie.
const chips = computed(() =>
  props.sources.map((source, i) => ({ source, hotkey: SOURCE_HOTKEYS[i] ?? null })),
)
</script>

<template>
  <div class="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex justify-center px-4">
    <div
      class="pointer-events-auto flex flex-col rounded-xl border border-border bg-popover shadow-2xl
             overflow-hidden max-w-[min(92vw,56rem)]"
    >
      <!-- One-line header: what you're writing to, and where -->
      <div class="flex items-center gap-2 px-2.5 py-1.5 border-b border-border bg-muted/40">
        <span
          class="size-2 rounded-full shrink-0"
          :style="{ backgroundColor: `oklch(65% 0.18 ${track.typeHue ?? 250})` }"
        />
        <span class="text-xs font-semibold text-foreground truncate">{{ track.name }}</span>
        <span class="text-[11px] font-mono text-muted-foreground tabular-nums shrink-0">{{ tc }}</span>
        <div class="flex-1 min-w-4" />
        <button
          type="button"
          class="shrink-0 -mr-0.5 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          :title="$t('editor.sourceBar.close')"
          @click="$emit('close')"
        >
          <Icon icon="mdi:close" class="size-3.5" />
        </button>
      </div>

      <div v-if="chips.length" class="flex flex-wrap gap-1 p-1.5 max-h-40 overflow-y-auto">
        <button
          v-for="{ source, hotkey } in chips"
          :key="source.id"
          type="button"
          :title="$t('editor.sourceBar.addsAt', { tc })"
          class="flex items-center gap-1.5 rounded-lg border py-1 pr-2 transition-all active:scale-[0.97]"
          :class="[
            hotkey ? 'pl-1' : 'pl-2',
            source.id === flashSourceId  ? 'border-primary bg-primary/20'
            : source.id === activeSourceId ? 'border-primary/60 bg-primary/10'
            : 'border-border bg-background hover:bg-accent hover:border-muted-foreground/40',
          ]"
          @click="$emit('add', source)"
        >
          <kbd
            v-if="hotkey"
            class="flex items-center justify-center size-[18px] rounded border border-border bg-muted
                   text-[10px] font-mono font-semibold text-muted-foreground shrink-0"
          >{{ hotkey }}</kbd>
          <SourceBadge :short-name="source.shortName" :hue="source.hue" />
          <span class="text-xs font-medium text-foreground whitespace-nowrap">{{ source.name }}</span>
        </button>
      </div>

      <p v-else class="px-3 py-2 text-xs text-muted-foreground">
        {{ $t('editor.sourceBar.noSources') }}
      </p>
    </div>
  </div>
</template>
