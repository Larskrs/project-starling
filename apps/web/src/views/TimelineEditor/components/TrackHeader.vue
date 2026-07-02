<script setup>
import { ref } from 'vue'
import { Icon } from '@iconify/vue'

const props = defineProps({
  track: { type: Object, required: true },
})

const emit = defineEmits(['toggle-mute', 'toggle-lock', 'add-clip', 'delete'])

const hovered = ref(false)
</script>

<template>
  <div
    class="h-10 flex items-center gap-1.5 px-2 border-b border-border group"
    :class="track.isMuted ? 'opacity-50' : ''"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <!-- Type color dot -->
    <span
      class="size-2 rounded-full shrink-0"
      :style="{ backgroundColor: track.typeColor ?? 'oklch(65% 0.18 250)' }"
    />

    <!-- Name -->
    <span class="flex-1 text-xs font-medium text-foreground truncate min-w-0">{{ track.name }}</span>

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

      <!-- Mute -->
      <button
        class="size-5 flex items-center justify-center rounded transition-colors"
        :class="track.isMuted ? 'text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent'"
        :title="track.isMuted ? $t('editor.unmute') : $t('editor.mute')"
        @click.stop="$emit('toggle-mute')"
      >
        <Icon :icon="track.isMuted ? 'mdi:volume-off' : 'mdi:volume-medium'" class="size-3.5" />
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
  </div>
</template>
