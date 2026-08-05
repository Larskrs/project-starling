<script setup>
import { ref } from 'vue'
import { Icon } from '@iconify/vue'
import { DropdownMenuRoot, DropdownMenuTrigger } from 'radix-vue'
import {
  Checkbox, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@starling/ui'
import { useStorage } from './storage.js'
import { fileUrl, thumbnailUrl } from './useStorageApi.js'
import { fileIcon } from './fileKinds.js'
import { formatBytes } from '../../lib/utils.js'

/**
 * One file in the grid. The thumbnail is the only thing that varies by type,
 * so it's a branch here rather than a component per type.
 *
 * Selecting, renaming, moving and deleting all go through the storage context —
 * the tile names the action, the root owns the dialog. In picker mode a click
 * picks the file and the management affordances step out of the way.
 */
defineProps({ file: { type: Object, required: true } })

const { picker, selection, actions, activate } = useStorage()
const { active: selectionActive, isSelected, toggle } = selection

const menuOpen = ref(false)

const openInTab = (file) => window.open(fileUrl(file.id), '_blank')
</script>

<template>
  <DropdownMenuRoot v-model:open="menuOpen">
    <div
      class="group relative rounded-lg overflow-hidden transition-all"
      :class="isSelected(file.id) ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''"
      @contextmenu.prevent="!picker && (menuOpen = true)"
    >
      <!-- Selection checkbox (top-left, fades in on hover) -->
      <button
        v-if="!picker"
        class="absolute top-1.5 left-1.5 z-10 p-0.5 transition-opacity"
        :class="selectionActive || isSelected(file.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
        @click.stop="toggle(file.id)"
      >
        <Checkbox :checked="isSelected(file.id)" />
      </button>

      <!-- Dots trigger (top-right) -->
      <DropdownMenuTrigger v-if="!picker" as-child>
        <button
          class="absolute top-1.5 right-1.5 z-10 p-1 rounded transition-opacity opacity-0 group-hover:opacity-100 bg-background/70 hover:bg-background/95 text-muted-foreground hover:text-foreground"
          :class="{ 'opacity-100': menuOpen }"
          @click.stop
        >
          <Icon icon="mdi:dots-horizontal" class="text-base" />
        </button>
      </DropdownMenuTrigger>

      <button class="w-full aspect-video block overflow-hidden rounded-lg" @click="activate(file)">
        <img
          v-if="thumbnailUrl(file)"
          :src="thumbnailUrl(file)"
          :alt="file.name"
          class="w-full h-full object-cover transition-transform duration-300"
          loading="lazy"
        />
        <div
          v-else-if="file.type === 'audio'"
          class="w-full h-full bg-gradient-to-br from-blue-500/10 via-indigo-500/10 to-purple-500/10 flex flex-col items-center justify-center gap-3"
        >
          <Icon icon="mdi:waveform" class="text-5xl text-blue-400/60 group-hover:text-blue-400/80 transition-colors" />
          <Icon icon="mdi:play-circle-outline" class="text-2xl text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
        </div>
        <div v-else class="w-full h-full bg-muted/40 flex items-center justify-center">
          <Icon :icon="fileIcon(file)" class="text-5xl text-muted-foreground/40 group-hover:text-muted-foreground/60 transition-colors" />
        </div>
      </button>

      <div class="px-0.5 py-2">
        <p class="text-sm font-medium text-foreground truncate leading-snug">{{ file.name }}</p>
        <p class="text-xs mt-1 text-muted-foreground leading-snug">
          {{ formatBytes(file.size) }}
          <span v-if="file.versions?.length > 1"> · {{ file.versions.length }}v</span>
        </p>
      </div>
    </div>

    <DropdownMenuContent align="end">
      <DropdownMenuLabel>{{ $t('storage.file.menu') }}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem icon="mdi:open-in-new" @click="openInTab(file)">{{ $t('storage.file.open') }}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem icon="mdi:pencil-outline" @click="actions.rename(file)">{{ $t('storage.rename') }}</DropdownMenuItem>
      <DropdownMenuItem icon="mdi:folder-move-outline" @click="actions.move(file)">{{ $t('storage.file.move') }}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem icon="mdi:delete-outline" destructive @click="actions.remove(file)">
        {{ $t('storage.delete') }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenuRoot>
</template>
