<script setup>
import { ref, shallowRef, computed, inject, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { clipLeft, clipWidth } from '../useEditorUtils.js'
import { getPeakPyramid, pickLevel } from '../useWaveform.js'

const props = defineProps({
  clip:         { type: Object, required: true },
  track:        { type: Object, required: true },
  timeline:     { type: Object, required: true },
  pxPerFrame:   { type: Number, required: true },
  height:       { type: Number, default: 48 },   // track row height
  nextPosition: { type: Number, default: null },
})

const emit = defineEmits(['edit', 'delete', 'crop', 'move'])

const allSources = inject('editor-sources', ref([]))
const hovered    = ref(false)
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

const color = computed(() => {
  if (source.value?.hue != null) return `oklch(62% 0.17 ${source.value.hue})`
  return props.clip.color ?? props.track.typeColor ?? 'oklch(65% 0.18 250)'
})

// ── Drag to move ──────────────────────────────────────────────────────────────
const moveAdj  = ref(0)   // pixel offset applied during drag
let _moveStartX = 0
let _didMove    = false   // true once movement threshold is exceeded

function startMove(e) {
  if (e.button !== 0) return
  _moveStartX = e.clientX
  _didMove    = false
  document.addEventListener('mousemove', onMoveMove)
  document.addEventListener('mouseup', onMoveEnd, { once: true })
}

function onMoveMove(e) {
  const dx = e.clientX - _moveStartX
  if (!_didMove && Math.abs(dx) > 3) {
    _didMove       = true
    dragging.value = true
  }
  if (_didMove) moveAdj.value = dx
}

function onMoveEnd(e) {
  document.removeEventListener('mousemove', onMoveMove)
  if (_didMove) {
    const dx          = e.clientX - _moveStartX
    const deltaFrames = Math.round(dx / props.pxPerFrame)
    const newPosition = Math.max(props.timeline.startFrame, props.clip.position + deltaFrames)
    if (deltaFrames !== 0) emit('move', newPosition)
  }
  moveAdj.value  = 0
  dragging.value = false
}

// Prevent "edit" from opening when the user just finished a drag.
function onClipClick() {
  if (_didMove) { _didMove = false; return }
  emit('edit')
}

// ── Crop drag ─────────────────────────────────────────────────────────────────
const cropAdj = ref({ left: 0, width: 0 })
let _cropSide   = null
let _cropStartX = 0

function startCrop(side, e) {
  e.stopPropagation()
  _cropSide      = side
  _cropStartX    = e.clientX
  dragging.value = true
  document.addEventListener('mousemove', onCropMove)
  document.addEventListener('mouseup', onCropEnd, { once: true })
}

function onCropMove(e) {
  const dx = e.clientX - _cropStartX
  cropAdj.value = _cropSide === 'left'
    ? { left: dx, width: -dx }
    : { left: 0,  width: dx }
}

function onCropEnd(e) {
  document.removeEventListener('mousemove', onCropMove)
  const dx          = e.clientX - _cropStartX
  const deltaFrames = Math.round(dx / props.pxPerFrame)

  if (_cropSide === 'left') {
    const ms    = props.clip.mediaStart ?? 0
    const me    = props.clip.end ?? (ms + 1)
    const newMs = Math.max(0, Math.min(ms + deltaFrames, me - 1))
    if (newMs !== ms) emit('crop', { mediaStart: newMs })
  } else {
    const ms    = props.clip.mediaStart ?? 0
    const me    = props.clip.end ?? (ms + 1)
    const newMe = Math.max(ms + 1, me + deltaFrames)
    if (newMe !== me) emit('crop', { end: newMe })
  }

  cropAdj.value  = { left: 0, width: 0 }
  dragging.value = false
  _cropSide      = null
}

// ── Displayed geometry (includes any in-progress drag / crop offsets) ──────────
const displayedLeft  = computed(() => left.value + cropAdj.value.left + moveAdj.value)
const displayedWidth = computed(() => Math.max(2, baseWidth.value + cropAdj.value.width))

const bgStyle = computed(() => ({
  backgroundColor: color.value,
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

// Scroll position + width of the editor canvas, shared from index.vue.
const viewport = inject('editor-viewport', ref({ scrollLeft: 0, width: 0 }))

// Visible slice of this clip in px, relative to its left edge, expanded by a
// margin so scrolling doesn't reveal an undrawn edge. Null when fully off-screen,
// so a clip costs the same to draw whether 2 seconds or 2 hours of it exist.
const PREFETCH_PX = 240
const visibleWindow = computed(() => {
  const clipL = displayedLeft.value
  const clipR = clipL + displayedWidth.value
  const viewL = viewport.value.scrollLeft - PREFETCH_PX
  const viewR = viewport.value.scrollLeft + viewport.value.width + PREFETCH_PX
  const start = Math.max(clipL, viewL)
  const end   = Math.min(clipR, viewR)
  if (end <= start) return null
  return { offset: Math.floor(start - clipL), width: Math.ceil(end - start) }
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
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
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
  [waveCanvas, pyramid, visibleWindow,
   () => props.clip.mediaStart, () => props.clip.end,
   () => props.pxPerFrame, () => props.height,
   () => cropAdj.value.left, () => cropAdj.value.width],
  drawWaveform,
  { flush: 'post' },
)
</script>

<template>
  <!-- Narrow point marker: source-backed clips on clip-mode tracks -->
  <div
    v-if="isPoint"
    class="absolute top-1 bottom-1 rounded-sm flex items-start justify-center select-none"
    :style="bgStyle"
    @mousedown="startMove"
    @click.stop="onClipClick"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <div
      v-if="hovered && !dragging"
      class="absolute -top-7 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-popover border border-border rounded shadow-sm px-1.5 py-0.5 z-20 whitespace-nowrap"
    >
      <span v-if="source" class="text-[10px] font-bold" :style="{ color }">{{ source.shortName }}</span>
      <span v-if="clip.label" class="text-[10px] text-muted-foreground">{{ clip.label }}</span>
      <button class="size-4 flex items-center justify-center text-muted-foreground hover:text-foreground ml-0.5" @mousedown.stop @click.stop="$emit('edit')">
        <Icon icon="mdi:pencil-outline" class="size-3" />
      </button>
      <button class="size-4 flex items-center justify-center text-muted-foreground hover:text-destructive" @mousedown.stop @click.stop="$emit('delete')">
        <Icon icon="mdi:trash-can-outline" class="size-3" />
      </button>
    </div>
  </div>

  <!-- Block: event-mode (span-to-next) and clip-mode media blocks -->
  <div
    v-else
    class="absolute top-1 bottom-1 rounded flex items-center overflow-hidden select-none"
    :style="bgStyle"
    @mousedown="startMove"
    @click.stop="onClipClick"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <!-- Left crop handle (clip-mode only) -->
    <div
      v-if="!isEventTrack"
      class="absolute left-0 top-0 bottom-0 w-1.5 z-20 cursor-col-resize bg-black/20 hover:bg-white/30 transition-colors rounded-l"
      @mousedown.stop="startCrop('left', $event)"
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

    <!-- Label -->
    <span class="relative z-10 text-[10px] font-semibold text-white/90 truncate leading-none select-none px-2 flex-1">
      {{ isEventTrack && source ? source.shortName : (clip.label || track.name) }}
    </span>

    <!-- Hover actions (hidden while dragging) -->
    <div
      v-if="hovered && !dragging"
      class="relative z-10 flex gap-0.5 bg-black/30 rounded px-0.5 py-0.5 shrink-0 mr-2"
      @mousedown.stop
      @click.stop
    >
      <button class="size-4 flex items-center justify-center text-white/80 hover:text-white" @click.stop="$emit('edit')">
        <Icon icon="mdi:pencil-outline" class="size-3" />
      </button>
      <button class="size-4 flex items-center justify-center text-white/80 hover:text-red-300" @click.stop="$emit('delete')">
        <Icon icon="mdi:trash-can-outline" class="size-3" />
      </button>
    </div>

    <!-- Right crop handle (clip-mode only) -->
    <div
      v-if="!isEventTrack"
      class="absolute right-0 top-0 bottom-0 w-1.5 z-20 cursor-col-resize bg-black/20 hover:bg-white/30 transition-colors rounded-r"
      @mousedown.stop="startCrop('right', $event)"
    />
  </div>
</template>
