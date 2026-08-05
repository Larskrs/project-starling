<script setup>
import { Icon } from '@iconify/vue'
import { Button, IconButton } from '@starling/ui'
import { useStorage } from './storage.js'

/** Appears once something is ticked; acts on the whole selection. */
const { browser, selection, actions } = useStorage()
const { visibleFiles } = browser
const { active, count, clear, selectAll } = selection
</script>

<template>
  <Transition name="sel-bar">
    <div
      v-if="active"
      class="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border bg-card text-sm"
    >
      <span class="font-medium text-foreground">{{ $t('storage.selection.count', { n: count }) }}</span>
      <button
        class="text-xs text-muted-foreground hover:text-foreground transition-colors"
        @click="selectAll(visibleFiles.map(f => f.id))"
      >{{ $t('storage.selection.selectAll') }}</button>

      <div class="flex-1" />

      <Button size="xs" variant="outline" @click="actions.moveSelected()">
        <Icon icon="mdi:folder-move-outline" class="mr-1 text-base" />
        {{ $t('storage.selection.move') }}
      </Button>
      <Button size="xs" variant="destructive" @click="actions.deleteSelected()">
        <Icon icon="mdi:trash-can-outline" class="mr-1 text-base" />
        {{ $t('storage.selection.delete') }}
      </Button>
      <IconButton icon="mdi:close" class="ml-1 p-1" :title="$t('storage.selection.clear')" @click="clear()" />
    </div>
  </Transition>
</template>

<style scoped>
.sel-bar-enter-active, .sel-bar-leave-active { transition: opacity 0.15s, transform 0.15s; }
.sel-bar-enter-from,   .sel-bar-leave-to     { opacity: 0; transform: translateY(-6px); }
</style>
