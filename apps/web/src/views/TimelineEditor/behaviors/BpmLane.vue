<script setup>
import { computed, inject, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { clipLeft } from '../useEditorUtils.js'

// Dedicated strip for metronome tracks (metronome overrides trackDisplay).
// Renders ruler-like beat/bar tick lines with bar numbers; each BPM clip shows
// as a draggable ♩-chip whose tempo applies until the next clip.
const props = defineProps({
  track:      { type: Object,  required: true },
  timeline:   { type: Object,  required: true },
  pxPerFrame: { type: Number,  required: true },
  height:     { type: Number,  default: 36 },
  selected:   { type: Boolean, default: false },
  muted:      { type: Boolean, default: false },
})

const emit = defineEmits(['seek', 'edit-clip', 'delete-clip', 'move-clip'])

const viewport = inject('editor-viewport', ref({ scrollLeft: 0, width: 0 }))

const hoveredId  = ref(null)
const dragId     = ref(null)
const dragOffset = ref(0)

const fps = computed(() => parseFloat(props.timeline.frameRate) || 25)

// Tempo segments: each BPM clip applies from its position until the next one.
// Bar numbers run continuously; a tempo change always starts a new bar (the
// metronome restarts its beat phase there too).
const segments = computed(() => {
  const list = props.track.clips
    .map(clip => ({
      clip,
      start:       clip.position,
      bpm:         Number(clip.data?.bpm),
      beatsPerBar: Math.max(1, Math.min(12, Number(clip.data?.beatsPerBar) || 4)),
    }))
    .filter(s => Number.isFinite(s.bpm) && s.bpm > 0)
    .sort((a, b) => a.start - b.start)

  let bar = 1
  for (let i = 0; i < list.length; i++) {
    const seg = list[i]
    seg.end           = list[i + 1]?.start ?? props.timeline.endFrame
    seg.framesPerBeat = (fps.value * 60) / seg.bpm
    seg.startBar      = bar
    const beats = Math.max(0, (seg.end - seg.start) / seg.framesPerBeat)
    bar += Math.max(1, Math.ceil(beats / seg.beatsPerBar))
  }
  return list
})

const MIN_BEAT_PX = 5    // hide per-beat ticks when packed tighter than this
const MIN_BAR_PX  = 28   // thin bar lines/numbers to every 2nd/4th/… bar below this

// Beat + bar marks, culled to the visible viewport (a long timeline holds
// thousands of beats — only the on-screen slice is materialised).
const marks = computed(() => {
  const px           = props.pxPerFrame
  const { startFrame, endFrame } = props.timeline
  const vw           = viewport.value
  const viewWidthPx  = vw.width || 1600
  const viewFrom     = startFrame + (vw.scrollLeft - 64) / px
  const viewTo       = startFrame + (vw.scrollLeft + viewWidthPx + 64) / px

  const beats = []
  const bars  = []
  for (const seg of segments.value) {
    const from = Math.max(seg.start, viewFrom)
    const to   = Math.min(seg.end, viewTo, endFrame)
    if (to <= from) continue

    const beatPx = seg.framesPerBeat * px
    const barPx  = beatPx * seg.beatsPerBar
    let barStep  = 1
    while (barPx * barStep < MIN_BAR_PX) barStep *= 2

    const firstBeat = Math.max(0, Math.floor((from - seg.start) / seg.framesPerBeat))
    const lastBeat  = Math.floor((to - seg.start) / seg.framesPerBeat)
    for (let k = firstBeat; k <= lastBeat; k++) {
      const frame = seg.start + k * seg.framesPerBeat
      if (frame >= seg.end) break
      const x = (frame - startFrame) * px
      if (k % seg.beatsPerBar === 0) {
        const barIndex = k / seg.beatsPerBar
        if (barIndex % barStep === 0) {
          bars.push({ x, n: seg.startBar + barIndex, showNumber: barPx * barStep >= MIN_BAR_PX })
        }
      } else if (beatPx >= MIN_BEAT_PX) {
        beats.push({ x })
      }
    }
  }
  return { beats, bars }
})

// All clips get a chip — even ones without a valid bpm (shown as ♩ —) so they
// stay editable/deletable; only valid tempos contribute segments/lines above.
// Chips are viewport-culled like the beat/bar marks (160px covers a chip).
const chips = computed(() => {
  const viewL = viewport.value.scrollLeft - 160
  const viewR = viewport.value.scrollLeft + (viewport.value.width || 1600) + 32
  const out = []
  for (const clip of props.track.clips) {
    const x = clipLeft(clip, props.timeline.startFrame, props.pxPerFrame)
    if (x < viewL || x > viewR) continue
    out.push({ clip, x, text: `♩ ${Number(clip.data?.bpm) || '—'}` })
  }
  return out
})

// ── Drag to move ──────────────────────────────────────────────────────────────
let _startX  = 0
let _didMove = false

function startDrag(clip, e) {
  if (e.button !== 0) return
  _startX  = e.clientX
  _didMove = false
  dragId.value     = clip.id
  dragOffset.value = 0
  const onMove = (ev) => {
    const dx = ev.clientX - _startX
    if (!_didMove && Math.abs(dx) > 3) _didMove = true
    if (_didMove) dragOffset.value = dx
  }
  const onUp = (ev) => {
    window.removeEventListener('pointermove', onMove)
    if (_didMove) {
      const deltaFrames = Math.round((ev.clientX - _startX) / props.pxPerFrame)
      const position    = Math.max(props.timeline.startFrame, clip.position + deltaFrames)
      if (deltaFrames !== 0) emit('move-clip', { clip, position })
    }
    dragId.value     = null
    dragOffset.value = 0
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp, { once: true })
}

function onChipClick(clip) {
  if (_didMove) { _didMove = false; return }
  emit('edit-clip', clip)
}

// Clicking empty lane space seeks the playhead to that position.
function onBackgroundClick(e) {
  const rect  = e.currentTarget.getBoundingClientRect()
  const frame = props.timeline.startFrame + (e.clientX - rect.left) / props.pxPerFrame
  emit('seek', frame)
}
</script>

<template>
  <div
    class="relative border-b border-border bg-muted/40"
    :class="muted ? 'opacity-50' : ''"
    :style="{ height: height + 'px' }"
  >
    <div
      class="absolute inset-0 transition-colors cursor-crosshair"
      :class="selected ? 'bg-primary/10' : ''"
      @click="onBackgroundClick"
    />

    <!-- Beat ticks (short, along the bottom, ruler-style) -->
    <div
      v-for="beat in marks.beats"
      :key="'b' + beat.x"
      class="absolute bottom-0 h-4 w-px bg-border/60 pointer-events-none"
      :style="{ left: beat.x + 'px' }"
    />

    <!-- Bar lines with bar numbers -->
    <div
      v-for="bar in marks.bars"
      :key="'n' + bar.n"
      class="absolute inset-y-0 pointer-events-none"
      :style="{ left: bar.x + 'px' }"
    >
      <div class="absolute inset-y-0 w-px bg-border" />
      <span
        v-if="bar.showNumber"
        class="absolute bottom-0.5 left-1 text-[9px] font-mono text-muted-foreground/70 leading-none"
      >
        {{ bar.n }}
      </span>
    </div>

    <!-- BPM chips -->
    <div
      v-for="{ clip, x, text } in chips"
      :key="clip.id"
      class="absolute top-1 flex items-center"
      :class="dragId === clip.id ? 'z-20' : ''"
      :style="{ left: (x + (dragId === clip.id ? dragOffset : 0)) + 'px' }"
      @mouseenter="hoveredId = clip.id"
      @mouseleave="hoveredId = null"
    >
      <button
        type="button"
        class="ml-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold leading-none
               bg-background border border-border text-foreground hover:border-primary/60 transition-colors whitespace-nowrap touch-none"
        :class="dragId === clip.id ? 'cursor-grabbing border-primary shadow-md' : 'cursor-grab'"
        @pointerdown.prevent="startDrag(clip, $event)"
        @click.stop="onChipClick(clip)"
      >
        {{ text }}
      </button>

      <button
        v-if="hoveredId === clip.id && dragId !== clip.id"
        type="button"
        class="ml-0.5 size-4 flex items-center justify-center rounded text-muted-foreground hover:text-destructive"
        @click.stop="$emit('delete-clip', clip)"
      >
        <Icon icon="mdi:close" class="size-3" />
      </button>
    </div>
  </div>
</template>
