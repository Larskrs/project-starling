<script setup>
import { ref, computed, inject, watch, onBeforeUnmount } from 'vue'
import { Icon } from '@iconify/vue'
import { clamp } from '../lib/editorUtils'
import { createDrag } from '../lib/pointerDrag'
import { SNAP_PX, nearestTarget } from '../lib/snapping'

// One draggable value chip on a strip lane (ruler labels, BPM changes).
// Drag horizontally to move the clip (it snaps like any clip; hold Alt to place
// it freely), click to select (Ctrl/⌘ adds, Shift selects a range),
// double-click to edit, hover for delete.
// The default slot renders anchored decorations (e.g. a position tick).
const props = defineProps({
  clip:        { type: Object, required: true },
  x:           { type: Number, required: true },
  text:        { type: String, default: '—' },
  pxPerFrame:  { type: Number, required: true },
  minPosition: { type: Number, default: 0 },
  maxPosition: { type: Number, default: Infinity },
  /** Locked track: read-only — no drag, no edit, no delete affordance. */
  locked:      { type: Boolean, default: false },
  selected:    { type: Boolean, default: false },
})

// select(clip, { toggle, range })
const emit = defineEmits(['select', 'edit', 'delete', 'move'])

// Editor-wide context, inert when absent (see EditorClip).
const canvas   = inject('editor-canvas', ref(null))
const snap     = inject('editor-snap', null)
const readonly = inject('editor-readonly', ref(false))
const rejected = inject('editor-rejected', ref(null))
const group    = inject('editor-group', null)

const isLocked = computed(() => props.locked || readonly.value)

const hovered  = ref(false)
const dragging = ref(false)

// The position shown while dragging and after release until the committed row
// arrives — so the chip doesn't bounce back for a round trip. Same contract as
// EditorClip's held geometry.
const HOLD_TIMEOUT_MS = 4000
const heldPosition = ref(null)
let _holdTimer = null

function releaseHold() {
  heldPosition.value = null
  if (_holdTimer) { clearTimeout(_holdTimer); _holdTimer = null }
}

watch(() => props.clip.position, () => { if (!dragging.value) releaseHold() })
watch(rejected, (r) => { if (r?.clipId === props.clip.id && !dragging.value) releaseHold() })
onBeforeUnmount(releaseHold)

// Following another selected clip that is being dragged.
const followDelta = computed(() => {
  const drag = group?.drag.value
  return drag && props.selected && drag.leaderId !== props.clip.id ? drag.delta : 0
})

const offsetPx = computed(() => {
  if (heldPosition.value != null) return (heldPosition.value - props.clip.position) * props.pxPerFrame
  return followDelta.value * props.pxPerFrame
})

let _didMove  = false
let _startPos = 0
let _targets  = []
let _group    = null
let _bounds   = null

const startDrag = createDrag({
  scrollContainer: () => canvas.value,
  autoScroll: true,
  onStart: () => {
    _startPos = props.clip.position
    _group    = group ? group.membersFor(props.clip.id) : null
    _bounds   = _group ? group.deltaBounds(_group) : null
    _targets  = snap ? snap.targets(_group ?? [props.clip.id]) : []
  },
  onMove: ({ dx, event }) => {
    // Keeps it mounted if dragged off screen; a group keeps its selection.
    if (!dragging.value && !_group) emit('select', props.clip, {})
    _didMove = true
    dragging.value = true
    let frame = _startPos + dx / props.pxPerFrame
    const hit = snap && !event.altKey ? nearestTarget(_targets, frame, SNAP_PX / props.pxPerFrame) : null
    if (hit != null) frame = hit
    let position
    if (_group) {
      position = _startPos + clamp(Math.round(frame) - _startPos, _bounds.min, _bounds.max)
      group.drag.value = { leaderId: props.clip.id, delta: position - _startPos }
    } else {
      position = clamp(Math.round(frame), props.minPosition, props.maxPosition)
    }
    if (snap) snap.guide.value = hit != null && position === hit ? hit : null
    heldPosition.value = position
  },
  onEnd: ({ moved, cancelled }) => {
    const wasDragging = dragging.value
    dragging.value = false
    if (snap) snap.guide.value = null
    if (!wasDragging) return

    const position = heldPosition.value
    if (cancelled || !moved || position == null || position === props.clip.position) {
      releaseHold()
      if (_group) group.drag.value = null
      return
    }
    if (_group) {
      // Moved locally inside the emit — see EditorClip.
      emit('move', { clip: props.clip, position })
      group.drag.value = null
      releaseHold()
      return
    }
    if (_holdTimer) clearTimeout(_holdTimer)
    _holdTimer = setTimeout(() => { _holdTimer = null; heldPosition.value = null }, HOLD_TIMEOUT_MS)
    emit('move', { clip: props.clip, position })
  },
})

function onPointerdown(e) {
  _didMove = false
  // Ctrl/⌘- and Shift-clicks build a selection; they never pick the chip up.
  if (isLocked.value || e.ctrlKey || e.metaKey || e.shiftKey) return
  startDrag(e)
}

function onClick(e) {
  if (_didMove) { _didMove = false; return }
  emit('select', props.clip, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey })
}

function onDblClick() {
  if (isLocked.value) return
  emit('edit', props.clip)
}
</script>

<template>
  <div
    class="absolute flex items-center"
    :class="dragging || selected ? 'z-20' : ''"
    :style="{ left: (x + offsetPx) + 'px' }"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <slot />

    <button
      type="button"
      class="ml-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold leading-none
             bg-background border text-foreground hover:border-primary/60 transition-colors whitespace-nowrap touch-none select-none"
      :class="[
        isLocked ? 'cursor-default' : dragging ? 'cursor-grabbing shadow-md' : 'cursor-grab',
        dragging || selected ? 'border-primary' : 'border-border',
        selected ? 'ring-1 ring-primary' : '',
      ]"
      @pointerdown.prevent="onPointerdown"
      @click.stop="onClick"
      @dblclick.stop="onDblClick"
      @contextmenu="emit('select', clip, { keep: true })"
    >
      {{ text }}
    </button>

    <button
      v-if="hovered && !dragging && !isLocked"
      type="button"
      class="ml-0.5 size-4 flex items-center justify-center rounded text-muted-foreground hover:text-destructive"
      @click.stop="$emit('delete', clip)"
    >
      <Icon icon="mdi:close" class="size-3" />
    </button>
  </div>
</template>
