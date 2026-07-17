<script setup>
import { computed } from 'vue'
import { clipLeft } from '../useEditorUtils.js'
import { useViewportRange } from '../useViewportRange.js'
import LaneChip from './LaneChip.vue'

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

const marksRange = useViewportRange(64)
const chipsRange = useViewportRange(160)

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
  const viewFrom     = startFrame + marksRange.value.left / px
  const viewTo       = startFrame + marksRange.value.right / px

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
  const { left, right } = chipsRange.value
  const out = []
  for (const clip of props.track.clips) {
    const x = clipLeft(clip, props.timeline.startFrame, props.pxPerFrame)
    if (x < left || x > right) continue
    out.push({ clip, x, text: `♩ ${Number(clip.data?.bpm) || '—'}` })
  }
  return out
})

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
    <LaneChip
      v-for="{ clip, x, text } in chips"
      :key="clip.id"
      class="top-1"
      :clip="clip"
      :x="x"
      :text="text"
      :px-per-frame="pxPerFrame"
      :min-position="timeline.startFrame"
      @edit="$emit('edit-clip', $event)"
      @delete="$emit('delete-clip', $event)"
      @move="$emit('move-clip', $event)"
    />
  </div>
</template>
