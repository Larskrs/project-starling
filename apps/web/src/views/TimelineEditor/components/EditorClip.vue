<script setup>
import { ref, computed, inject, watch, watchEffect } from 'vue'
import { Icon } from '@iconify/vue'
import { clipLeft, clipWidth } from '../useEditorUtils.js'
import { getAudioBuffer, getWaveformPeaks } from '../useAudioEngine.js'

const props = defineProps({
  clip:         { type: Object, required: true },
  track:        { type: Object, required: true },
  timeline:     { type: Object, required: true },
  pxPerFrame:   { type: Number, required: true },
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

const bgStyle = computed(() => ({
  backgroundColor: color.value,
  left:   (left.value + cropAdj.value.left + moveAdj.value) + 'px',
  width:  Math.max(2, baseWidth.value + cropAdj.value.width) + 'px',
  cursor: dragging.value ? 'grabbing' : 'grab',
  zIndex: dragging.value ? 30 : undefined,
}))

// ── Waveform ──────────────────────────────────────────────────────────────────
const waveCanvas     = ref(null)
const waveformPeaks  = ref(null)
const bufferDuration = ref(0)

function drawWaveform() {
  const canvas = waveCanvas.value
  const peaks  = waveformPeaks.value
  if (!canvas || !peaks || !bufferDuration.value) return

  const fps = parseFloat(props.timeline.frameRate)
  const ms  = props.clip.mediaStart ?? 0
  const me  = props.clip.end
  if (!me || me <= ms) return

  // While a crop drag is in progress, adjust the visible window so the canvas
  // buffer matches the clip's actual CSS display width (avoiding squish).
  // Left drag shifts the audio start forward; right drag grows/shrinks the end.
  const adjStartFrames = cropAdj.value.left / props.pxPerFrame
  const effectiveMs    = ms + adjStartFrames
  const W = Math.max(1, Math.round(baseWidth.value + cropAdj.value.width))
  const H = 38

  canvas.width  = W
  canvas.height = H

  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, W, H)

  const totalFrames = bufferDuration.value * fps

  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth   = 1
  ctx.beginPath()
  const mid = H / 2
  for (let px = 0; px < W; px++) {
    const audioFrame = effectiveMs + px / props.pxPerFrame
    const frac       = audioFrame / totalFrames
    if (frac < 0 || frac >= 1) continue
    const amp = peaks[Math.floor(frac * peaks.length)] ?? 0
    const y   = amp * mid * 0.9
    ctx.moveTo(px + 0.5, mid - y)
    ctx.lineTo(px + 0.5, mid + y)
  }
  ctx.stroke()
}

// Load peaks whenever the file changes.
watch(() => props.clip.fileId, async (fileId) => {
  waveformPeaks.value  = null
  bufferDuration.value = 0
  if (!fileId || isPoint.value || isEventTrack.value || props.clip.fileType !== 'audio') return
  try {
    const [buf, peaks] = await Promise.all([
      getAudioBuffer(fileId),
      getWaveformPeaks(fileId),
    ])
    bufferDuration.value = buf.duration
    waveformPeaks.value  = peaks
  } catch {}
}, { immediate: true })

// Redraw whenever peaks, clip bounds, canvas ref, or pixel width change.
// Explicit deps avoid the reactivity-tracking gaps that watchEffect can miss
// when props.clip is replaced entirely with a new object after a PATCH.
watch(
  [waveCanvas, waveformPeaks, bufferDuration,
   () => props.clip.mediaStart, () => props.clip.end,
   () => props.pxPerFrame, baseWidth,
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

    <!-- Waveform canvas (audio clips) -->
    <canvas
      v-else-if="clip.fileId && clip.fileType === 'audio'"
      ref="waveCanvas"
      class="absolute inset-0 pointer-events-none"
      style="width: 100%; height: 100%;"
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
