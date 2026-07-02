<script setup>
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { Avatar } from '@starling/ui'
import { framesToTC } from '../useEditorUtils.js'

const props = defineProps({
  timeline:      { type: Object,  required: true },
  pxPerFrame:    { type: Number,  required: true },
  playheadFrame: { type: Number,  required: true },
  isPlaying:     { type: Boolean, default: false },
  peers:         { type: Array,   default: () => [] },
  syncConnected: { type: Boolean, default: false },
})

const emit = defineEmits(['go-back', 'zoom-in', 'zoom-out', 'add-track', 'toggle-play', 'seek-start', 'seek-end'])

const tc = computed(() => framesToTC(props.playheadFrame, props.timeline.frameRate))

const MAX_AVATARS    = 5
const shownPeers     = computed(() => props.peers.slice(0, MAX_AVATARS))
const overflowCount  = computed(() => Math.max(0, props.peers.length - MAX_AVATARS))

function initials(name) {
  return name.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}
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

    <!-- Timeline name + frame rate -->
    <div class="flex items-center gap-2 min-w-0">
      <Icon icon="mdi:timeline-outline" class="size-4 text-muted-foreground shrink-0" />
      <span class="text-sm font-semibold text-foreground truncate">{{ timeline.name }}</span>
      <span class="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
        {{ timeline.frameRate }} fps
      </span>
    </div>

    <div class="flex-1" />

    <!-- Presence + live sync -->
    <div
      class="flex items-center gap-2 shrink-0 mr-1"
      :title="syncConnected ? $t('editor.liveSync') : $t('editor.syncOffline')"
    >
      <span
        class="size-2 rounded-full shrink-0"
        :class="syncConnected ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/40'"
      />
      <div v-if="peers.length > 1" class="flex items-center -space-x-1.5">
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

    <div class="w-px h-5 bg-border shrink-0 mx-1" />

    <!-- Playback controls -->
    <div class="flex items-center gap-1 shrink-0">
      <!-- Rewind to start -->
      <button
        class="size-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        title="Go to start (Home)"
        @click="$emit('seek-start')"
      >
        <Icon icon="mdi:skip-backward" class="size-4" />
      </button>

      <!-- Play / Pause -->
      <button
        class="size-8 flex items-center justify-center rounded-md transition-colors"
        :class="isPlaying
          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent'"
        title="Play / Pause (Space)"
        @click="$emit('toggle-play')"
      >
        <Icon :icon="isPlaying ? 'mdi:pause' : 'mdi:play'" class="size-4" />
      </button>

      <!-- Jump to end -->
      <button
        class="size-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        title="Go to end (End)"
        @click="$emit('seek-end')"
      >
        <Icon icon="mdi:skip-forward" class="size-4" />
      </button>
    </div>

    <!-- Timecode display -->
    <div class="font-mono text-sm tabular-nums text-foreground bg-muted/60 px-2.5 py-1 rounded-md shrink-0">
      {{ tc }}
    </div>

    <div class="w-px h-5 bg-border shrink-0 mx-1" />

    <!-- Zoom controls -->
    <div class="flex items-center gap-1 shrink-0">
      <button
        class="size-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        :title="$t('editor.zoomOut')"
        @click="$emit('zoom-out')"
      >
        <Icon icon="mdi:magnify-minus-outline" class="size-4" />
      </button>
      <span class="text-xs text-muted-foreground tabular-nums w-12 text-center">
        {{ pxPerFrame }}×
      </span>
      <button
        class="size-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        :title="$t('editor.zoomIn')"
        @click="$emit('zoom-in')"
      >
        <Icon icon="mdi:magnify-plus-outline" class="size-4" />
      </button>
    </div>

  </header>
</template>
