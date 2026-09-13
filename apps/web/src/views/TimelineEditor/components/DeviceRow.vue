<script setup>
import { computed } from 'vue'
import { Avatar } from '@starling/ui'
import { isDevicePresence } from '@starling/realtime'

/**
 * API accounts in the room, listed by profile at the bottom of the tracks
 * column.
 *
 * Kept out of the toolbar's avatar stack: a lighting desk or playout server is
 * not a collaborator, and mixed in with people it reads as someone watching.
 * Renders nothing while none are connected, so the column gives up no space.
 */
const props = defineProps({
  /** Everyone in the room, as presence reports it; devices are picked out here. */
  peers: { type: Array, default: () => [] },
})

const devices = computed(() => props.peers.filter(p => isDevicePresence(p.id)))

function initials(name) {
  return name.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}
</script>

<template>
  <ul v-if="devices.length" class="flex flex-wrap items-center gap-1.5">
    <li
      v-for="device in devices"
      :key="device.id"
      class="flex items-center gap-1.5 min-w-0 rounded-full border border-border bg-background pl-0.5 pr-2 py-0.5"
      :title="device.name"
    >
      <Avatar :id="device.avatarImageId" :alt="device.name" :quality="25" class="size-5 rounded-full shrink-0">
        <span class="text-[8px] font-bold leading-none">{{ initials(device.name) }}</span>
      </Avatar>
      <span class="text-xs text-foreground truncate">{{ device.name }}</span>
    </li>
  </ul>
</template>
