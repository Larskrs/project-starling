<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import { Icon } from '@iconify/vue'
import { ResizeHandle, Slider } from '@starling/ui'
import {
  DropdownMenuRoot, DropdownMenuTrigger,
  PopoverRoot, PopoverAnchor, PopoverPortal, PopoverContent,
} from 'radix-vue'
import DropdownMenuContent   from '@starling/ui/DropdownMenuContent'
import DropdownMenuItem      from '@starling/ui/DropdownMenuItem'
import DropdownMenuSeparator from '@starling/ui/DropdownMenuSeparator'
import type { EditorTrack } from '../../../types/timeline'

const props = withDefaults(defineProps<{
  track: EditorTrack
  height?: number
  selected?: boolean
  /** Ruler-display tracks have a fixed slim height — no resize handle. */
  resizable?: boolean
  /** Client-local mute state (persisted locally, not on the server). */
  muted?: boolean
  /**
   * Whether this track can make sound. Decides what its toggle MEANS: silence
   * for a track that plays something, hide for one that is pure notation — and
   * only the former gets a level to set.
   */
  supportsAudio?: boolean
  /** Client-local level in 0..1. Ignored when the track has no audio. */
  volume?: number
  /** Viewer without edit rights: only the local mix controls remain. */
  readonly?: boolean
}>(), {
  height: 56,
  selected: false,
  resizable: true,
  muted: false,
  supportsAudio: true,
  volume: 1,
  readonly: false,
})

// reorder-start fires on any row pointerdown; the parent only enters reorder
// mode after a >=5px vertical drag, so plain clicks still select as before.
const emit = defineEmits<{
  select: []
  'toggle-mute': []
  'toggle-lock': []
  'add-clip': []
  delete: []
  settings: []
  'resize-start': [event: PointerEvent]
  'reorder-start': [event: PointerEvent]
  'update:volume': [volume: number]
}>()

const menuOpen = ref(false)

// The track's own icon wins; otherwise it shows whatever its type provides.
const icon = computed(() => props.track.icon || props.track.typeIcon || null)

// Rows stretch from 28px (ruler strips) to 256px. Only the text scale adapts —
// the row is a single line at every height, so nothing reflows as it's resized.
const compact = computed(() => props.height < 40)

// Controls stay out of sight until the row is engaged with, so a tall stack of
// headers reads as a list of track names instead of a wall of buttons. Anything
// carrying state — mute, an open menu — stays visible regardless of hover.
const showControls = computed(() =>
  props.selected || props.muted || menuOpen.value || volumeOpen.value)

// A speaker for anything that plays; an eye for notation tracks, where the
// toggle hides the lane rather than silencing something that never sounded.
const toggleIcon = computed(() => {
  if (!props.supportsAudio) return props.muted ? 'mdi:eye-off-outline' : 'mdi:eye-outline'
  return props.muted ? 'mdi:volume-off' : 'mdi:volume-medium'
})

const toggleLabel = computed(() => {
  if (!props.supportsAudio) return props.muted ? 'editor.showTrack' : 'editor.hideTrack'
  return props.muted ? 'editor.unmute' : 'editor.mute'
})

// ── Volume flyout ─────────────────────────────────────────────────────────
// A vertical fader that rises out of the speaker icon on hover, mixer-style.
//
// It is PORTALLED rather than absolutely positioned in the row: the track
// header column is `overflow-y-hidden`, so a flyout drawn above the first few
// rows would simply be clipped off. The portal also gets collision flipping for
// free, so a track near the top of the viewport opens downward instead.
const volumeOpen = ref(false)
const dragging   = ref(false)
let closeTimer: ReturnType<typeof setTimeout> | null = null

/** Only audio tracks have a level; notation tracks just toggle visibility. */
const showVolume = computed(() => props.supportsAudio)

function openVolume(): void {
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
  volumeOpen.value = true
}

/**
 * A short grace period covers the gap the pointer crosses between the icon and
 * the fader above it, and a drag in progress holds it open regardless — letting
 * it close under the pointer mid-drag would be maddening.
 */
function closeVolume(): void {
  if (closeTimer) clearTimeout(closeTimer)
  closeTimer = setTimeout(() => {
    closeTimer = null
    if (!dragging.value) volumeOpen.value = false
  }, 120)
}

function startDrag(): void {
  dragging.value = true
  const end = (): void => {
    dragging.value = false
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    closeVolume()
  }
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}

onBeforeUnmount(() => { if (closeTimer) clearTimeout(closeTimer) })

// The slider works in whole percent — smoother to drag and to read out than a
// float, and the engine takes 0..1.
const volumePercent = computed({
  get: () => Math.round(props.volume * 100),
  set: (v: number) => emit('update:volume', v / 100),
})
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
      <!-- Anchor rather than trigger: the button's click is the mute toggle, and
           a trigger would flip the flyout open state on the same click. Hover
           drives `open` instead. -->
      <PopoverRoot v-model:open="volumeOpen">
        <PopoverAnchor as-child>
          <button
            class="flex items-center justify-center rounded-md transition-colors hover:bg-accent"
            :class="[
              compact ? 'size-6' : 'size-7',
              muted ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            ]"
            :title="$t(toggleLabel)"
            @click.stop="$emit('toggle-mute')"
            @pointerdown.stop
            @pointerenter="showVolume && openVolume()"
            @pointerleave="closeVolume()"
          >
            <Icon :icon="toggleIcon" class="size-4" />
          </button>
        </PopoverAnchor>

        <PopoverPortal v-if="showVolume">
          <PopoverContent
            side="top"
            :side-offset="6"
            :collision-padding="8"
            class="z-50 flex w-9 flex-col items-center gap-1.5 rounded-lg border border-border
                   bg-popover px-1.5 py-2 shadow-md outline-none"
            @open-auto-focus.prevent
            @pointerdown.stop
            @click.stop
            @pointerenter="openVolume()"
            @pointerleave="closeVolume()"
          >
            <span class="text-[10px] tabular-nums text-muted-foreground">{{ volumePercent }}</span>
            <Slider
              v-model="volumePercent"
              orientation="vertical"
              :min="0"
              :max="100"
              :step="1"
              :disabled="muted"
              :label="$t('editor.trackVolume', { name: track.name })"
              class="h-24"
              @pointerdown="startDrag()"
            />
          </PopoverContent>
        </PopoverPortal>
      </PopoverRoot>

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
          <DropdownMenuItem v-if="!readonly" icon="mdi:plus" :disabled="track.isLocked" @click="$emit('add-clip')">
            {{ $t('editor.addClip') }}
          </DropdownMenuItem>
          <DropdownMenuItem :icon="toggleIcon" @click="$emit('toggle-mute')">
            {{ $t(toggleLabel) }}
          </DropdownMenuItem>
          <template v-if="!readonly">
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
          </template>
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
