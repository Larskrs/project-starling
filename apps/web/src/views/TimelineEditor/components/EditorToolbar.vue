<script setup>
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { Button } from '@starling/ui'
import { framesToTC } from '../useEditorUtils.js'

const props = defineProps({
  timeline:      { type: Object,  required: true },
  pxPerFrame:    { type: Number,  required: true },
  playheadFrame: { type: Number,  required: true },
  isPlaying:     { type: Boolean, default: false },
})

const emit = defineEmits(['go-back', 'zoom-in', 'zoom-out', 'add-track', 'toggle-play', 'seek-start'])

const tc = computed(() => framesToTC(props.playheadFrame, props.timeline.frameRate))
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

    <div class="w-px h-5 bg-border shrink-0 mx-1" />

    <!-- Add track -->
    <Button size="sm" @click="$emit('add-track')">
      <Icon icon="mdi:plus" class="text-base" />
      {{ $t('editor.addTrack') }}
    </Button>

  </header>
</template>
