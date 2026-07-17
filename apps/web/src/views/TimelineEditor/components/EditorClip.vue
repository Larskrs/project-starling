<script setup>
import { ref, shallowRef, computed, inject, watch } from 'vue'
import { clipLeft, clipWidth } from '../useEditorUtils.js'
import { createDrag } from '../usePointerDrag.js'
import { useViewportRange } from '../useViewportRange.js'
import { getPeakPyramid, pickLevel } from '../useWaveform.js'
import { ContextMenuRoot, ContextMenuTrigger } from 'radix-vue'
import ContextMenuContent   from '@starling/ui/ContextMenuContent'
import ContextMenuItem      from '@starling/ui/ContextMenuItem'
import ContextMenuSeparator from '@starling/ui/ContextMenuSeparator'

const props = defineProps({
  clip:         { type: Object, required: true },
  track:        { type: Object, required: true },
  timeline:     { type: Object, required: true },
  pxPerFrame:   { type: Number, required: true },
  height:       { type: Number, default: 48 },   // track row height
  nameDisplay:  { type: String, default: 'normal' }, // 'normal' | 'stretch' | 'emphasize' (track type setting)
  clipDisplay:  { type: String, default: 'normal' }, // 'normal' | 'zebra' | 'border' | 'transparent'
  nextPosition: { type: Number, default: null },
})

const emit = defineEmits(['edit', 'delete', 'crop', 'move'])

const allSources = inject('editor-sources', ref([]))
const dragging   = ref(false)

const isEventTrack = computed(() => props.track.mode === 'event')

// Narrow point marker: source-backed clips on clip-mode tracks only.
const isPoint = computed(() => !isEventTrack.value && props.clip.sourceId != null)

const left = computed(() => clipLeft(props.clip, props.timeline.startFrame, props.pxPerFrame))

const baseWidth = computed(() => {
  if (isEventTrack.value) {
    // Span to the frame before the next clip starts (or to timeline end)
    const nextStart = props.nextPosition ?? props.timeline.endFrame
    return Math.max(props.pxPerFrame, (nextStart - props.clip.position) * props.pxPerFrame)
  }
  if (isPoint.value) return Math.max(2, props.pxPerFrame)
  return clipWidth(props.clip, props.pxPerFrame)
})

const source = computed(() =>
  props.clip.sourceId ? allSources.value.find(s => s.id === props.clip.sourceId) : null,
)

// Hue precedence: source → clip override → track type → default. Lightness and
// chroma come from theme-aware CSS (see the style block), so the same hue reads
// correctly in light and dark mode and per clip-display method.
const hue = computed(() =>
  source.value?.hue ?? props.clip.hue ?? props.track.typeHue ?? 250,
)

// Faint bodies (border/transparent) sit on the lane background — their text and
// waveform must follow the theme's foreground rather than assume a dark fill.
const faintBody = computed(() => props.clipDisplay === 'border' || props.clipDisplay === 'transparent')

// Label text + stretch-mode SVG geometry: viewBox sized to the text's natural
// proportions, preserveAspectRatio="none" then distorts it to fill the clip.
// A clip with both a source and a custom label combines them ("K1 - Total shot").
const labelText = computed(() => {
  const short = source.value?.shortName
  if (short && props.clip.label) return `${short} - ${props.clip.label}`
  if (isEventTrack.value && source.value) return short
  return props.clip.label || props.track.name
})
const stretchViewBox = computed(() =>
  `0 0 ${Math.max(24, labelText.value.length * 11)} 40`,
)

// ── Drag to move ──────────────────────────────────────────────────────────────
const moveAdj = ref(0)   // pixel offset applied during drag
let _didMove  = false    // true once movement threshold is exceeded

const startMove = createDrag({
  onStart: () => { _didMove = false },
  onMove:  ({ dx }) => { _didMove = true; dragging.value = true; moveAdj.value = dx },
  onEnd:   ({ dx, moved }) => {
    if (moved) {
      const deltaFrames = Math.round(dx / props.pxPerFrame)
      const newPosition = Math.max(props.timeline.startFrame, props.clip.position + deltaFrames)
      if (deltaFrames !== 0) emit('move', newPosition)
    }
    moveAdj.value  = 0
    dragging.value = false
  },
})

// Double-click opens the clip settings dialog (single click is reserved for
// selecting / dragging); the context menu's "Edit" item does the same. Guard
// against a drag that ends in a stray double-click.
function onClipDblClick() {
  if (_didMove) { _didMove = false; return }
  emit('edit')
}

// ── Crop drag ─────────────────────────────────────────────────────────────────
const cropAdj = ref({ left: 0, width: 0 })
let _cropSide = null

const cropDrag = createDrag({
  threshold: 0,
  onStart: () => { dragging.value = true },
  onMove: ({ dx }) => {
    cropAdj.value = _cropSide === 'left'
      ? { left: dx, width: -dx }
      : { left: 0,  width: dx }
  },
  onEnd: ({ dx }) => {
    const deltaFrames = Math.round(dx / props.pxPerFrame)
    const ms = props.clip.mediaStart ?? 0
    const me = props.clip.end ?? (ms + 1)

    if (_cropSide === 'left') {
      const newMs = Math.max(0, Math.min(ms + deltaFrames, me - 1))
      if (newMs !== ms) emit('crop', { mediaStart: newMs })
    } else {
      const newMe = Math.max(ms + 1, me + deltaFrames)
      if (newMe !== me) emit('crop', { end: newMe })
    }

    cropAdj.value  = { left: 0, width: 0 }
    dragging.value = false
    _cropSide      = null
  },
})

function startCrop(side, e) {
  _cropSide = side
  cropDrag(e)
}

// ── Displayed geometry (includes any in-progress drag / crop offsets) ──────────
const displayedLeft  = computed(() => left.value + cropAdj.value.left + moveAdj.value)
const displayedWidth = computed(() => Math.max(2, baseWidth.value + cropAdj.value.width))

// Body rendering is class-based (tl-clip-*) off a --clip-hue variable, so the
// theme (`.dark`) picks appropriate lightness/chroma per display method.
const clipBodyClass = computed(() =>
  `tl-clip-${['normal', 'zebra', 'border', 'transparent'].includes(props.clipDisplay) ? props.clipDisplay : 'normal'}`,
)

const bgStyle = computed(() => ({
  '--clip-hue': hue.value,
  left:   displayedLeft.value + 'px',
  width:  displayedWidth.value + 'px',
  cursor: dragging.value ? 'grabbing' : 'grab',
  zIndex: dragging.value ? 30 : undefined,
}))

// ── Waveform (multi-resolution, viewport-culled) ───────────────────────────────
const waveCanvas = ref(null)
// shallowRef: the pyramid holds large Float32Arrays and is immutable — no point
// paying for Vue's deep reactive proxying of it.
const pyramid    = shallowRef(null)

const isAudioClip = computed(() =>
  !!props.clip.fileId && props.clip.fileType === 'audio' && !isPoint.value && !isEventTrack.value,
)

// Visible slice of this clip in px, relative to its left edge, snapped to
// CHUNK_PX tiles. Only chunks actually inside the viewport (± one chunk of
// margin) exist on the canvas, and because the window is quantized — and the
// same object is returned while it's unchanged — scrolling within a chunk
// triggers no redraw at all; a repaint happens only when a new chunk enters.
// Null when fully off-screen.
const CHUNK_PX  = 256
const viewRange = useViewportRange(CHUNK_PX)
let _prevWin = null
const visibleWindow = computed(() => {
  const clipL = displayedLeft.value
  const clipW = displayedWidth.value
  const { left: viewL, right: viewR } = viewRange.value
  const start = Math.max(clipL, viewL)
  const end   = Math.min(clipL + clipW, viewR)
  if (end <= start) { _prevWin = null; return null }

  const offset = Math.max(0, Math.floor((start - clipL) / CHUNK_PX) * CHUNK_PX)
  const width  = Math.min(clipW, Math.ceil((end - clipL) / CHUNK_PX) * CHUNK_PX) - offset
  if (!_prevWin || _prevWin.offset !== offset || _prevWin.width !== width) {
    _prevWin = { offset, width: Math.ceil(width) }
  }
  return _prevWin
})

function drawWaveform() {
  const canvas = waveCanvas.value
  const py     = pyramid.value
  const win    = visibleWindow.value
  if (!canvas || !py || !win) return

  const fps = parseFloat(props.timeline.frameRate)
  const ms  = props.clip.mediaStart ?? 0
  const me  = props.clip.end
  if (!me || me <= ms) return

  // Left-crop drag shifts the audio window start.
  const effectiveMs = ms + cropAdj.value.left / props.pxPerFrame

  const dpr = window.devicePixelRatio || 1
  const W   = Math.max(1, win.width)
  const H   = Math.max(8, props.height - 8)  // clip is inset top-1/bottom-1 in the row
  canvas.width  = Math.round(W * dpr)
  canvas.height = Math.round(H * dpr)

  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)

  // Pick the peak resolution that matches the current zoom.
  const samplesPerPixel = py.sampleRate / (props.pxPerFrame * fps)
  const level  = py.levels[pickLevel(py, samplesPerPixel)]
  const perBin = level.samplesPerBin
  const nBins  = level.min.length
  const mid    = H / 2

  const binAt = (px) => {
    const audioFrame = effectiveMs + (win.offset + px) / props.pxPerFrame
    return Math.floor((audioFrame / fps) * py.sampleRate / perBin)
  }

  // Filled trace: top edge (max) left→right, bottom edge (min) right→left.
  // Solid bodies get a white trace; faint bodies use the hue so the waveform
  // stays visible against the lane background in either theme.
  ctx.fillStyle = faintBody.value ? `oklch(55% 0.16 ${hue.value} / 0.6)` : 'rgba(255,255,255,0.5)'
  ctx.beginPath()
  ctx.moveTo(0, mid)
  for (let px = 0; px < W; px++) {
    const bin = binAt(px)
    const max = bin >= 0 && bin < nBins ? level.max[bin] : 0
    ctx.lineTo(px, mid - max * mid * 0.92)
  }
  for (let px = W - 1; px >= 0; px--) {
    const bin = binAt(px)
    const min = bin >= 0 && bin < nBins ? level.min[bin] : 0
    ctx.lineTo(px, mid - min * mid * 0.92)
  }
  ctx.closePath()
  ctx.fill()
}

// Build/fetch the peak pyramid lazily — only once the clip is on screen (or
// within the prefetch margin), so opening a timeline doesn't fetch and decode
// every audio file up front. Off-screen clips stay undecoded until scrolled to.
watch(
  [() => props.clip.fileId, isAudioClip, () => visibleWindow.value !== null],
  ([fileId, audio, visible], prev) => {
    if (prev && fileId !== prev[0]) pyramid.value = null
    if (!audio || !visible || pyramid.value) return
    getPeakPyramid(fileId)
      .then(p => { if (props.clip.fileId === fileId) pyramid.value = p })
      .catch(() => {})
  },
  { immediate: true },
)

// Redraw on peaks ready, zoom, clip bounds, crop, or viewport scroll.
// Explicit deps avoid the reactivity gaps watchEffect can miss when props.clip
// is replaced with a fresh object after a PATCH.
watch(
  [waveCanvas, pyramid, visibleWindow, hue, faintBody,
   () => props.clip.mediaStart, () => props.clip.end,
   () => props.pxPerFrame, () => props.height,
   () => cropAdj.value.left, () => cropAdj.value.width],
  drawWaveform,
  { flush: 'post' },
)
</script>

<template>
  <ContextMenuRoot>
    <!-- as-child: the clip element itself is the right-click target; the menu
         opens at the cursor position (ContextMenu, not an anchored dropdown).
         v-if = narrow point marker (source-backed, clip-mode); v-else = block. -->
    <ContextMenuTrigger as-child>
      <div
        v-if="isPoint"
        class="absolute top-1 bottom-1 rounded-sm flex items-start justify-center select-none touch-none tl-clip-normal"
        :style="bgStyle"
        @pointerdown="startMove"
        @click.stop
        @dblclick.stop="onClipDblClick"
      />

      <div
        v-else
        class="absolute top-1 bottom-1 rounded flex items-center overflow-hidden select-none touch-none"
        :class="clipBodyClass"
        :style="bgStyle"
        @pointerdown="startMove"
        @click.stop
        @dblclick.stop="onClipDblClick"
      >
        <!-- Left crop handle (clip-mode only) -->
        <div
          v-if="!isEventTrack"
          class="absolute left-0 top-0 bottom-0 w-1.5 z-20 cursor-col-resize bg-black/20 hover:bg-white/30 transition-colors rounded-l"
          @pointerdown.stop="startCrop('left', $event)"
        />

        <!-- Image background (image clips) -->
        <img
          v-if="clip.fileId && clip.fileType === 'image'"
          :src="`/api/storage/${clip.fileId}/serve?quality=30`"
          class="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style="opacity: 0.55;"
          :alt="clip.label || ''"
        />

        <!-- Waveform canvas (audio clips) — sized/positioned to the visible window only -->
        <canvas
          v-else-if="isAudioClip && visibleWindow"
          ref="waveCanvas"
          class="absolute top-0 bottom-0 pointer-events-none"
          :style="{ left: visibleWindow.offset + 'px', width: visibleWindow.width + 'px', height: '100%' }"
        />

        <!-- Label — stretch: SVG text distorted to fill the clip; emphasize: bold/centered; normal.
             Faint clip bodies use the theme foreground; solid bodies use white. -->
        <svg
          v-if="nameDisplay === 'stretch'"
          class="absolute inset-0 w-full h-full pointer-events-none z-10 px-1"
          :class="faintBody ? 'text-foreground/90' : ''"
          :viewBox="stretchViewBox"
          preserveAspectRatio="none"
        >
          <text
            x="50%" y="55%"
            text-anchor="middle" dominant-baseline="middle"
            font-size="26" font-weight="700"
            :fill="faintBody ? 'currentColor' : 'rgba(255,255,255,0.92)'"
          >{{ labelText }}</text>
        </svg>
        <span
          v-else-if="nameDisplay === 'emphasize'"
          class="relative z-10 text-sm font-bold tracking-wide truncate leading-none select-none px-2 flex-1 text-start"
          :class="faintBody ? 'text-foreground' : 'text-white'"
        >
          {{ labelText }}
        </span>
        <span
          v-else
          class="relative z-10 text-[10px] font-semibold truncate leading-none select-none px-2 flex-1"
          :class="faintBody ? 'text-foreground/90' : 'text-white/90'"
        >
          {{ labelText }}
        </span>
        <span v-if="nameDisplay === 'stretch'" class="flex-1" />

        <!-- Right crop handle (clip-mode only) -->
        <div
          v-if="!isEventTrack"
          class="absolute right-0 top-0 bottom-0 w-1.5 z-20 cursor-col-resize bg-black/20 hover:bg-white/30 transition-colors rounded-r"
          @pointerdown.stop="startCrop('right', $event)"
        />
      </div>
    </ContextMenuTrigger>

    <ContextMenuContent>
      <ContextMenuItem icon="mdi:pencil-outline" @click="$emit('edit')">{{ $t('editor.clipMenu.edit') }}</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem icon="mdi:delete-outline" destructive @click="$emit('delete')">{{ $t('editor.clipMenu.delete') }}</ContextMenuItem>
    </ContextMenuContent>
  </ContextMenuRoot>
</template>

<!-- Unscoped: the .dark ancestor selector must reach the html element.
     Lightness/chroma per theme; the clip supplies only --clip-hue. -->
<style>
.tl-clip-normal        { background: oklch(68% 0.2 var(--clip-hue)); }
.dark .tl-clip-normal  { background: oklch(58% 0.2 var(--clip-hue)); }

.tl-clip-zebra {
  background: repeating-linear-gradient(45deg,
    oklch(58% 0.14 var(--clip-hue)) 0 10px,
    oklch(50% 0.12 var(--clip-hue)) 10px 20px);
}
.dark .tl-clip-zebra {
  background: repeating-linear-gradient(45deg,
    oklch(50% 0.12 var(--clip-hue)) 0 10px,
    oklch(42% 0.10 var(--clip-hue)) 10px 20px);
}

.tl-clip-border        { background: oklch(58% 0.14 var(--clip-hue) / 0.15); border: 2px solid oklch(50% 0.16 var(--clip-hue)); }
.dark .tl-clip-border  { background: oklch(70% 0.25 var(--clip-hue) / 0.25); border-color: oklch(50% 0.25 var(--clip-hue)); }

.tl-clip-transparent       { background: transparent }
.dark .tl-clip-transparent { background: transparent }
</style>
