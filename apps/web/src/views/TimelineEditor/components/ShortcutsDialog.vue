<script setup lang="ts">
import { computed } from 'vue'
import { DialogTitle, DialogDescription } from 'radix-vue'
import Dialog        from '@starling/ui/Dialog'
import DialogContent from '@starling/ui/DialogContent'

// Everything the editor answers to, in one place. The editor's power features
// (hotkeys, nudging, snapping, undo) are otherwise invisible until someone
// stumbles onto them. Opened with "?" or the toolbar's keyboard button.
defineProps<{ open: boolean }>()
defineEmits<{ 'update:open': [open: boolean] }>()

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const mod   = isMac ? '⌘' : 'Ctrl'

interface Shortcut {
  /** Key chips; each inner array is one combination, joined with "+". */
  keys: string[][]
  label: string
}

const groups = computed<{ title: string; items: Shortcut[] }[]>(() => [
  {
    title: 'editor.shortcuts.playback',
    items: [
      { keys: [['Space']], label: 'editor.shortcuts.playPause' },
      { keys: [['←'], ['→']], label: 'editor.shortcuts.stepFrame' },
      { keys: [['Shift', '←'], ['Shift', '→']], label: 'editor.shortcuts.stepTen' },
      { keys: [['Home'], ['End']], label: 'editor.shortcuts.jumpEnds' },
      { keys: [['L']], label: 'editor.shortcuts.transportMode' },
    ],
  },
  {
    title: 'editor.shortcuts.editing',
    items: [
      { keys: [[mod, 'editor.shortcuts.keys.click']], label: 'editor.shortcuts.selectToggle' },
      { keys: [['Shift', 'editor.shortcuts.keys.click']], label: 'editor.shortcuts.selectRange' },
      { keys: [[mod, 'A']], label: 'editor.shortcuts.selectAll' },
      { keys: [[mod, 'Z']], label: 'editor.shortcuts.undo' },
      { keys: [[mod, 'Shift', 'Z']], label: 'editor.shortcuts.redo' },
      { keys: [['Delete'], ['Backspace']], label: 'editor.shortcuts.deleteClip' },
      { keys: [['Enter']], label: 'editor.shortcuts.editClip' },
      { keys: [[','], ['.']], label: 'editor.shortcuts.nudge' },
      { keys: [['Shift', ','], ['Shift', '.']], label: 'editor.shortcuts.nudgeTen' },
      { keys: [['editor.shortcuts.keys.doubleClick']], label: 'editor.shortcuts.addClip' },
      { keys: [['Alt', 'editor.shortcuts.keys.drag']], label: 'editor.shortcuts.freeDrag' },
      { keys: [['Esc']], label: 'editor.shortcuts.cancel' },
    ],
  },
  {
    title: 'editor.shortcuts.view',
    items: [
      { keys: [['+'], ['−']], label: 'editor.shortcuts.zoom' },
      { keys: [['Alt', '0']], label: 'editor.shortcuts.zoomReset' },
      { keys: [['Alt', 'editor.shortcuts.keys.wheel']], label: 'editor.shortcuts.zoomPointer' },
      { keys: [['Shift', 'editor.shortcuts.keys.wheel']], label: 'editor.shortcuts.scrollH' },
    ],
  },
  {
    title: 'editor.shortcuts.sources',
    items: [
      { keys: [['1'], ['…'], ['9'], ['0']], label: 'editor.shortcuts.addSource' },
      { keys: [['?']], label: 'editor.shortcuts.help' },
    ],
  },
])

// Key chips that are words ("Double-click") are i18n keys; the rest are literal.
const isKey = (k: string) => k.startsWith('editor.')
</script>

<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)">
    <DialogContent class="max-w-2xl p-6">
      <DialogTitle class="text-base font-semibold text-foreground">{{ $t('editor.shortcuts.title') }}</DialogTitle>
      <DialogDescription class="mt-1 text-sm text-muted-foreground">
        {{ $t('editor.shortcuts.description') }}
      </DialogDescription>

      <div class="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2 max-h-[70vh] overflow-y-auto">
        <section v-for="group in groups" :key="group.title">
          <h3 class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {{ $t(group.title) }}
          </h3>
          <ul class="flex flex-col gap-1.5">
            <li v-for="item in group.items" :key="item.label" class="flex items-center justify-between gap-3 text-sm">
              <span class="text-foreground">{{ $t(item.label) }}</span>
              <span class="flex shrink-0 items-center gap-1">
                <template v-for="(combo, ci) in item.keys" :key="ci">
                  <span v-if="ci > 0" class="text-xs text-muted-foreground">/</span>
                  <template v-for="(k, ki) in combo" :key="ki">
                    <span v-if="ki > 0" class="text-xs text-muted-foreground">+</span>
                    <kbd class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground whitespace-nowrap">
                      {{ isKey(k) ? $t(k) : k }}
                    </kbd>
                  </template>
                </template>
              </span>
            </li>
          </ul>
        </section>
      </div>
    </DialogContent>
  </Dialog>
</template>
