<script setup>
import { ref } from 'vue'
import { Icon } from '@iconify/vue'
import { ResizeHandle } from '@starling/ui'

const props = defineProps({
  track:     { type: Object,  required: true },
  height:    { type: Number,  default: 48 },
  selected:  { type: Boolean, default: false },
  /** Live info chip after the name (e.g. current BPM on metronome tracks). */
  badge:     { type: String,  default: '' },
  /** Ruler-display tracks have a fixed slim height — no resize handle. */
  resizable: { type: Boolean, default: true },
  /** Client-local mute state (persisted in a cookie, not on the server). */
  muted:     { type: Boolean, default: false },
})

// reorder-start fires on any row pointerdown; the parent only enters reorder
// mode after a ≥5px vertical drag, so plain clicks still select as before.
const emit = defineEmits(['select', 'toggle-mute', 'toggle-lock', 'add-clip', 'delete', 'resize-start', 'reorder-start'])

const hovered = ref(false)
</script>

<template>
  <div
    class="relative flex items-center gap-1.5 px-2 border-b border-border group cursor-pointer transition-colors select-none touch-none"
    :class="[
      muted ? 'opacity-50' : '',
      selected ? 'bg-accent/70 border-l-2 border-l-primary' : 'hover:bg-accent/30',
    ]"
    :style="{ height: height + 'px' }"
    @click="$emit('select')"
    @pointerdown="$emit('reorder-start', $event)"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <!-- Type color dot -->
    <span
      class="size-2 rounded-full shrink-0"
      :style="{ backgroundColor: `oklch(65% 0.18 ${track.typeHue ?? 250})` }"
    />

    <!-- Name -->
    <span class="flex-1 text-xs font-medium text-foreground truncate min-w-0">{{ track.name }}</span>

    <!-- Live badge (current BPM etc.) -->
    <span
      v-if="badge"
      class="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-muted text-muted-foreground tabular-nums max-w-24 truncate"
      :title="badge"
    >{{ badge }}</span>

    <!-- Controls (always visible) -->
    <div class="flex items-center gap-0.5 shrink-0">
      <!-- Add clip -->
      <button
        class="size-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        :title="$t('editor.addClip')"
        @click.stop="$emit('add-clip')"
      >
        <Icon icon="mdi:plus" class="size-3.5" />
      </button>

      <!-- Mute (client-local) -->
      <button
        class="size-5 flex items-center justify-center rounded transition-colors"
        :class="muted ? 'text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent'"
        :title="muted ? $t('editor.unmute') : $t('editor.mute')"
        @click.stop="$emit('toggle-mute')"
      >
        <Icon :icon="muted ? 'mdi:volume-off' : 'mdi:volume-medium'" class="size-3.5" />
      </button>

      <!-- Lock -->
      <button
        class="size-5 flex items-center justify-center rounded transition-colors"
        :class="track.isLocked ? 'text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent'"
        :title="track.isLocked ? $t('editor.unlock') : $t('editor.lock')"
        @click.stop="$emit('toggle-lock')"
      >
        <Icon :icon="track.isLocked ? 'mdi:lock' : 'mdi:lock-open-outline'" class="size-3.5" />
      </button>

      <!-- Delete (hover only) -->
      <button
        class="size-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
        :class="hovered ? 'opacity-100' : 'opacity-0 pointer-events-none'"
        :title="$t('editor.deleteTrack')"
        @click.stop="$emit('delete')"
      >
        <Icon icon="mdi:trash-can-outline" class="size-3.5" />
      </button>
    </div>

    <!-- Row height resize handle (click.stop so finishing a drag doesn't toggle selection) -->
    <ResizeHandle
      v-if="resizable"
      axis="y"
      class="absolute bottom-0 inset-x-0"
      @pointerdown.stop="$emit('resize-start', $event)"
      @click.stop
    />
  </div>
</template>
