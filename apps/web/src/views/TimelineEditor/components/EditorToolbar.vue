<script setup>
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { Avatar, Button } from '@starling/ui'
import { isDevicePresence } from '@starling/realtime'
import { framesToTC } from '../lib/editorUtils'
import ClockSyncControl from './ClockSyncControl.vue'

const props = defineProps({
  timeline:      { type: Object,  required: true },
  /** Current zoom as a display string (100% = the 5-minute-tick default). */
  zoomLabel:     { type: String,  default: '' },
  playheadFrame: { type: Number,  required: true },
  isPlaying:     { type: Boolean, default: false },
  peers:         { type: Array,   default: () => [] },
  syncConnected: { type: Boolean, default: false },
  /** Lost the live connection after having it — edits by others aren't arriving. */
  reconnecting:  { type: Boolean, default: false },
  /** Joined a playing room before the browser would let us make sound. */
  audioBlocked:  { type: Boolean, default: false },
  canUndo:       { type: Boolean, default: false },
  canRedo:       { type: Boolean, default: false },
  /** The viewer can't edit: undo/redo go, a badge says why nothing is draggable. */
  readonly:      { type: Boolean, default: false },
  /** Transport controls drive the room's shared playhead (true) or a local one. */
  transportLive: { type: Boolean, default: true },
  /** The room's transport is running — worth showing while this client is local. */
  roomPlaying:   { type: Boolean, default: false },
  /** The room's latest clock sync (ClockSyncStatus), or null. */
  clockStatus:   { type: Object,  default: null },
  /** Starts a room-wide clock sync; resolves to the server's ack. */
  resyncClocks:  { type: Function, required: true },
})

const emit = defineEmits([
  'go-back', 'zoom-in', 'zoom-out', 'zoom-fit', 'zoom-reset', 'add-track',
  'toggle-play', 'seek-start', 'seek-end', 'undo', 'redo', 'shortcuts',
  'update:transport-live',
])

const tc = computed(() => framesToTC(props.playheadFrame, props.timeline.frameRate))

// A Play is waiting for the room's clocks. Pressing the button again cancels it.
const playHeld = computed(() => !!props.clockStatus?.playHeld && !props.isPlaying)

// People only: API accounts are listed in their own row under the toolbar (DeviceRow).
const MAX_AVATARS    = 5
const people         = computed(() => props.peers.filter(p => !isDevicePresence(p.id)))
const shownPeers     = computed(() => people.value.slice(0, MAX_AVATARS))
const overflowCount  = computed(() => Math.max(0, people.value.length - MAX_AVATARS))

function initials(name) {
  return name.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}

const iconButton = 'size-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:pointer-events-none'
</script>

<template>
  <header class="h-12 shrink-0 flex items-center gap-2 px-3 border-b border-border bg-background z-30">

    <!-- Back -->
    <button
      class="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0 px-1.5 py-1 rounded-md hover:bg-accent"
      @click="$emit('go-back')"
    >
      <Icon icon="mdi:chevron-left" class="size-4" />
      {{ $t('editor.back') }}
    </button>

    <div class="w-px h-5 bg-border shrink-0 mx-1" />

    <!-- Timeline name -->
    <div class="flex items-center gap-2 min-w-0">
      <Icon icon="mdi:timeline-outline" class="size-4 text-muted-foreground shrink-0" />
      <span class="text-sm font-semibold text-foreground truncate">{{ timeline.name }}</span>
      <span
        v-if="readonly"
        class="shrink-0 flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
        :title="$t('editor.viewOnlyHint')"
      >
        <Icon icon="mdi:eye-outline" class="size-3.5" />
        {{ $t('editor.viewOnly') }}
      </span>
    </div>

    <div class="flex-1" />

    <!-- Presence + live sync. A dropped connection gets words, not just a grey
         dot: edits still save, but nobody else's changes are arriving. -->
    <div class="flex items-center gap-2 shrink-0 mr-1">
      <span
        v-if="reconnecting"
        class="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium
               bg-amber-500/15 text-amber-600 dark:text-amber-400"
        :title="$t('editor.reconnectingHint')"
      >
        <Icon icon="mdi:wifi-strength-alert-outline" class="size-4 animate-pulse" />
        {{ $t('editor.reconnecting') }}
      </span>
      <span
        v-else
        class="size-2 rounded-full shrink-0"
        :class="syncConnected ? 'bg-emerald-500' : 'bg-muted-foreground/40'"
        :title="syncConnected ? $t('editor.liveSync') : $t('editor.syncOffline')"
      />
      <div v-if="people.length > 1" class="flex items-center -space-x-1.5">
        <Avatar
          v-for="peer in shownPeers"
          :key="peer.id"
          :id="peer.avatarImageId"
          :created-at="peer.createdAt"
          :alt="peer.name"
          :quality="25"
          :title="peer.name"
          class="size-6 rounded-full ring-2 ring-background"
        >
          <span class="text-[9px] font-bold leading-none">{{ initials(peer.name) }}</span>
        </Avatar>
        <span
          v-if="overflowCount"
          class="size-6 rounded-full ring-2 ring-background bg-muted text-muted-foreground flex items-center justify-center text-[9px] font-medium"
        >+{{ overflowCount }}</span>
      </div>
    </div>

    <!-- Undo / redo -->
    <template v-if="!readonly">
      <div class="w-px h-5 bg-border shrink-0 mx-1" />
      <div class="flex items-center gap-1 shrink-0">
        <button :class="iconButton" :disabled="!canUndo" :title="$t('editor.undoTitle')" @click="$emit('undo')">
          <Icon icon="mdi:undo" class="size-4" />
        </button>
        <button :class="iconButton" :disabled="!canRedo" :title="$t('editor.redoTitle')" @click="$emit('redo')">
          <Icon icon="mdi:redo" class="size-4" />
        </button>
      </div>
    </template>

    <div class="w-px h-5 bg-border shrink-0 mx-1" />

    <!-- Transport mode. The controls beside it are the same either way; this
         decides whether they drive the room's live playhead or a local one. -->
    <div
      class="flex items-center rounded-md bg-muted p-0.5 shrink-0"
      role="radiogroup"
      :aria-label="$t('editor.transport.toggle')"
    >
      <button
        type="button"
        role="radio"
        :aria-checked="transportLive"
        class="relative flex items-center gap-1 h-6 px-2 rounded text-xs font-medium transition-colors"
        :class="transportLive ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
        :title="$t('editor.transport.liveHint')"
        @click="$emit('update:transport-live', true)"
      >
        <Icon icon="mdi:access-point" class="size-3.5" />
        {{ $t('editor.transport.live') }}
        <!-- Local, while the room plays on without us -->
        <span
          v-if="!transportLive && roomPlaying"
          class="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-emerald-500 animate-pulse"
          :title="$t('editor.transport.roomPlaying')"
        />
      </button>
      <button
        type="button"
        role="radio"
        :aria-checked="!transportLive"
        class="flex items-center gap-1 h-6 px-2 rounded text-xs font-medium transition-colors"
        :class="!transportLive
          ? 'bg-background text-amber-600 dark:text-amber-400 shadow-sm'
          : 'text-muted-foreground hover:text-foreground'"
        :title="$t('editor.transport.localHint')"
        @click="$emit('update:transport-live', false)"
      >
        <Icon icon="mdi:laptop" class="size-3.5" />
        {{ $t('editor.transport.local') }}
      </button>
    </div>

    <!-- Room-wide clock sync. Beside the transport it protects: press it before
         a show, and a Play pressed while it runs waits for every clock. -->
    <ClockSyncControl
      :status="clockStatus"
      :connected="syncConnected"
      :frame-rate="timeline.frameRate"
      :resync="resyncClocks"
    />

    <!-- Playback controls -->
    <div class="flex items-center gap-1 shrink-0">
      <!-- Rewind to start -->
      <Button
        class="w-10 h-7 flex p-0 items-center justify-center rounded-md"
        :title="$t('editor.goToStart')"
        variant="flat"
        @click="$emit('seek-start')"
      >
        <Icon icon="mdi:skip-backward" class="size-4" />
      </Button>

      <!-- Play / Pause — or waiting on the room's clocks -->
      <Button
        class="w-10 h-7 flex p-0 items-center justify-center rounded-md transition-colors"
        :class="isPlaying
          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : playHeld
            ? 'bg-amber-500/20 text-amber-700 dark:text-amber-400 hover:bg-amber-500/30'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent'"
        :title="playHeld ? $t('editor.clockSync.playHeldTitle') : $t('editor.playPause')"
        @click="$emit('toggle-play')"
      >
        <Icon
          :icon="isPlaying ? 'mdi:pause' : playHeld ? 'mdi:timer-sand' : 'mdi:play'"
          class="w-6 h-6"
          :class="playHeld ? 'animate-pulse' : 'text-white'"
        />
      </Button>

      <!-- Jump to end -->
      <Button
        class="w-10 h-7 flex p-0 items-center justify-center rounded-md"
        :title="$t('editor.goToEnd')"
        variant="flat"
        @click="$emit('seek-end')"
      >
        <Icon icon="mdi:skip-forward" class="size-4" />
      </Button>
    </div>

    <!-- Timecode display -->
    <div
      class="font-mono text-sm tabular-nums text-foreground bg-muted/60 px-2.5 py-1 rounded-md shrink-0"
      :class="transportLive ? '' : 'ring-1 ring-amber-500/60'"
    >
      {{ tc }}
    </div>

    <!--
      The transport is running but the browser is holding the audio silent
      (joined mid-playback with no interaction yet). Any click unlocks it, so
      this only has to explain the silence — clicking it is just the handiest
      gesture to do that with.
    -->
    <button
      v-if="audioBlocked"
      class="flex items-center gap-1.5 shrink-0 px-2 py-1 rounded-md text-xs font-medium
             bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25 transition-colors"
      :title="$t('editor.audioBlockedHint')"
    >
      <Icon icon="mdi:volume-off" class="size-4" />
      {{ $t('editor.audioBlocked') }}
    </button>

    <div class="w-px h-5 bg-border shrink-0 mx-1" />

    <!-- Zoom controls -->
    <div class="flex items-center gap-1 shrink-0">
      <button :class="iconButton" :title="$t('editor.zoomOut')" @click="$emit('zoom-out')">
        <Icon icon="mdi:magnify-minus-outline" class="size-4" />
      </button>
      <button
        class="text-xs text-muted-foreground hover:text-foreground tabular-nums w-12 text-center rounded-md py-1 hover:bg-accent transition-colors"
        :title="$t('editor.zoomReset')"
        @click="$emit('zoom-reset')"
      >
        {{ zoomLabel }}
      </button>
      <button :class="iconButton" :title="$t('editor.zoomIn')" @click="$emit('zoom-in')">
        <Icon icon="mdi:magnify-plus-outline" class="size-4" />
      </button>
      <button :class="iconButton" :title="$t('editor.zoomFit')" @click="$emit('zoom-fit')">
        <Icon icon="mdi:arrow-expand-horizontal" class="size-4" />
      </button>
    </div>

    <div class="w-px h-5 bg-border shrink-0 mx-1" />

    <button :class="iconButton" :title="$t('editor.shortcuts.open')" @click="$emit('shortcuts')">
      <Icon icon="mdi:keyboard-outline" class="size-4" />
    </button>

  </header>
</template>
