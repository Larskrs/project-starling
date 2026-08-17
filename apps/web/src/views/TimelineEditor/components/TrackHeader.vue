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

// Rows stretch from 28px (ruler strips) to 256px. Only the text scale adapts —
// the row is a single line at every height, so nothing reflows as it's resized.
const compact = computed(() => props.height < 40)

// Controls stay out of sight until the row is engaged with, so a tall stack of
// headers reads as a list of track names instead of a wall of buttons. Anything
// carrying state — mute, an open menu — stays visible regardless of hover.
const showControls = computed(() => props.selected || props.muted || menuOpen.value)
</script>

<template>
  <div
    class="relative flex items-center border-b border-border group cursor-pointer transition-colors select-none touch-none"
    :class="[
      muted ? 'opacity-60' : '',
      selected ? 'bg-accent/60' : 'hover:bg-accent/25',
    ]"
    :style="{ height: height + 'px' }"
    @click="$emit('select')"
    @pointerdown="$emit('reorder-start', $event)"
  >
    <!-- Type colour: one flat hairline, the row's only accent. Selection reads
         off the row background, so the stripe never changes width. -->
    <span
      class="absolute left-0 top-0 bottom-0 w-0.5"
      :class="selected ? '' : 'opacity-50'"
      :style="{ backgroundColor: `oklch(65% 0.18 ${track.typeHue ?? 250})` }"
    />

    <!-- Name -->
    <div class="flex-1 min-w-0 flex items-center gap-1.5 pl-3 pr-1">
      <span v-if="track.isLocked" class="shrink-0 flex items-center" :title="$t('editor.locked')">
        <Icon icon="mdi:lock" class="size-3 text-muted-foreground" />
      </span>
      <Icon
        v-if="icon"
        :icon="icon"
        class="shrink-0 text-muted-foreground"
        :class="compact ? 'size-3.5' : 'size-4'"
      />
      <span
        class="truncate min-w-0 font-medium text-foreground"
        :class="compact ? 'text-xs' : 'text-sm'"
      >{{ track.name }}</span>
    </div>

    <!-- Mute is the one control worth reaching for mid-session; everything else
         lives in the overflow menu. -->
    <div
      class="flex items-center gap-0.5 shrink-0 pr-1.5 transition-opacity"
      :class="showControls ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'"
    >
      <button
        class="flex items-center justify-center rounded-md transition-colors hover:bg-accent"
        :class="[
          compact ? 'size-6' : 'size-7',
          muted ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        ]"
        :title="muted ? $t('editor.unmute') : $t('editor.mute')"
        @click.stop="$emit('toggle-mute')"
        @pointerdown.stop
      >
        <Icon :icon="muted ? 'mdi:volume-off' : 'mdi:volume-medium'" class="size-4" />
      </button>

      <DropdownMenuRoot v-model:open="menuOpen">
        <DropdownMenuTrigger as-child>
          <button
            class="flex items-center justify-center rounded-md transition-colors hover:bg-accent"
            :class="[
              compact ? 'size-6' : 'size-7',
              menuOpen ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            ]"
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
