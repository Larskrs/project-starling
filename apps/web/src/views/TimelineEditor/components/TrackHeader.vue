<script setup>
import { ref, computed } from 'vue'
import { Icon } from '@iconify/vue'
import { ResizeHandle } from '@starling/ui'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'radix-vue'
import DropdownMenuContent   from '@starling/ui/DropdownMenuContent'
import DropdownMenuItem      from '@starling/ui/DropdownMenuItem'
import DropdownMenuSeparator from '@starling/ui/DropdownMenuSeparator'

const props = defineProps({
  track:     { type: Object,  required: true },
  height:    { type: Number,  default: 56 },
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
defineEmits(['select', 'toggle-mute', 'toggle-lock', 'add-clip', 'delete', 'settings', 'resize-start', 'reorder-start'])

const menuOpen = ref(false)

// The track's own icon wins; otherwise it shows whatever its type provides.
const icon = computed(() => props.track.icon || props.track.typeIcon || null)

// The row stretches from 28px (ruler strips) to 256px, so the layout adapts
// rather than assuming one size: slim rows keep a single line and drop the
// inline quick-add, tall rows get the badge on its own secondary line.
const compact    = computed(() => props.height < 40)
const stackBadge = computed(() => props.height >= 52 && !!props.badge)
</script>

<template>
  <div
    class="relative flex items-stretch border-b border-border group cursor-pointer transition-colors select-none touch-none"
    :class="[
      muted ? 'opacity-50' : '',
      selected ? 'bg-accent/70' : 'hover:bg-accent/30',
    ]"
    :style="{ height: height + 'px' }"
    @click="$emit('select')"
    @pointerdown="$emit('reorder-start', $event)"
  >
    <!-- Type colour stripe: full-height, and the selection indicator too (it
         widens rather than adding a second competing bar on the same edge). -->
    <span
      class="absolute left-0 top-0 bottom-0 rounded-r-sm transition-all"
      :class="selected ? 'w-1.5' : 'w-1 opacity-70 group-hover:opacity-100'"
      :style="{ backgroundColor: `oklch(65% 0.18 ${track.typeHue ?? 250})` }"
    />

    <!-- Name + secondary line -->
    <div class="flex-1 min-w-0 flex flex-col justify-center gap-0.5 pl-3.5 pr-1">
      <div class="flex items-center gap-1.5 min-w-0">
        <span v-if="track.isLocked" class="shrink-0 flex items-center" :title="$t('editor.locked')">
          <Icon icon="mdi:lock" class="size-3 text-muted-foreground" />
        </span>
        <Icon
          v-if="icon"
          :icon="icon"
          class="shrink-0"
          :class="compact ? 'size-3.5' : 'size-4'"
          :style="{ color: `oklch(65% 0.18 ${track.typeHue ?? 250})` }"
        />
        <span
          class="truncate min-w-0 font-medium text-foreground"
          :class="compact ? 'text-xs' : 'text-sm'"
        >{{ track.name }}</span>

        <!-- Slim rows have no second line — the badge rides beside the name -->
        <span
          v-if="badge && !stackBadge"
          class="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-muted text-muted-foreground tabular-nums max-w-24 truncate"
          :title="badge"
        >{{ badge }}</span>
      </div>

      <span
        v-if="stackBadge"
        class="text-[11px] font-mono text-muted-foreground tabular-nums truncate leading-tight"
        :title="badge"
      >{{ badge }}</span>
    </div>

    <!-- Quick actions: the two used mid-session. Everything else lives in the
         overflow menu so the row stays readable at any height. -->
    <div class="flex items-center gap-0.5 shrink-0 pr-1.5">
      <button
        v-if="!compact"
        class="size-7 flex items-center justify-center rounded-md transition-colors disabled:opacity-40 disabled:pointer-events-none
               text-muted-foreground hover:text-foreground hover:bg-accent"
        :disabled="track.isLocked"
        :title="track.isLocked ? $t('editor.locked') : $t('editor.addClip')"
        @click.stop="$emit('add-clip')"
        @pointerdown.stop
      >
        <Icon icon="mdi:plus" class="size-4" />
      </button>

      <button
        class="size-7 flex items-center justify-center rounded-md transition-colors"
        :class="muted ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-accent'"
        :title="muted ? $t('editor.unmute') : $t('editor.mute')"
        @click.stop="$emit('toggle-mute')"
        @pointerdown.stop
      >
        <Icon :icon="muted ? 'mdi:volume-off' : 'mdi:volume-medium'" class="size-4" />
      </button>

      <DropdownMenuRoot v-model:open="menuOpen">
        <DropdownMenuTrigger as-child>
          <button
            class="size-7 flex items-center justify-center rounded-md transition-colors"
            :class="menuOpen ? 'text-foreground bg-accent' : 'text-muted-foreground hover:text-foreground hover:bg-accent'"
            :title="$t('editor.trackMenu.more')"
            @click.stop
            @pointerdown.stop
          >
            <Icon icon="mdi:dots-vertical" class="size-4" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end">
          <DropdownMenuItem icon="mdi:plus" :disabled="track.isLocked" @click="$emit('add-clip')">
            {{ $t('editor.addClip') }}
          </DropdownMenuItem>
          <DropdownMenuItem
            :icon="muted ? 'mdi:volume-off' : 'mdi:volume-medium'"
            @click="$emit('toggle-mute')"
          >
            {{ muted ? $t('editor.unmute') : $t('editor.mute') }}
          </DropdownMenuItem>
          <DropdownMenuItem
            :icon="track.isLocked ? 'mdi:lock-open-outline' : 'mdi:lock'"
            @click="$emit('toggle-lock')"
          >
            {{ track.isLocked ? $t('editor.unlock') : $t('editor.lock') }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon="mdi:cog-outline" :disabled="track.isLocked" @click="$emit('settings')">
            {{ $t('editor.trackSettings') }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <!-- Deleting takes every clip with it — exactly what the lock guards -->
          <DropdownMenuItem
            icon="mdi:trash-can-outline"
            destructive
            :disabled="track.isLocked"
            @click="$emit('delete')"
          >
            {{ $t('editor.deleteTrack') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuRoot>
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
