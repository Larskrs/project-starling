<script setup>
import { ref, shallowRef, computed, inject, watch, onBeforeUnmount } from 'vue'
import { Icon } from '@iconify/vue'
import { clamp, clipLeft, clipWidth } from '../lib/editorUtils'
import { createDrag } from '../lib/pointerDrag'
import { SNAP_PX, nearestTarget, snapSpan } from '../lib/snapping'
import { useViewportRange } from '../view/useViewportRange'
import { getPeakPyramid, pickLevel } from '../audio/useWaveform'
import { useFileDownload } from '../media/useMediaDownloads'
import { describeDownload, getMediaObjectUrl } from '../media/mediaDownloads'
import { ContextMenuRoot, ContextMenuTrigger } from 'radix-vue'
import ContextMenuContent   from '@starling/ui/ContextMenuContent'
import ContextMenuItem      from '@starling/ui/ContextMenuItem'
import ContextMenuSeparator from '@starling/ui/ContextMenuSeparator'
import Spinner              from '@starling/ui/Spinner'

const props = defineProps({
  clip:         { type: Object, required: true },
  track:        { type: Object, required: true },
  timeline:     { type: Object, required: true },
  pxPerFrame:   { type: Number, required: true },
  height:       { type: Number, default: 48 },   // track row height
  nameDisplay:  { type: String, default: 'normal' }, // 'normal' | 'stretch' | 'emphasize' (track type setting)
  clipDisplay:  { type: String, default: 'normal' }, // 'normal' | 'zebra' | 'border' | 'transparent'
  nextPosition: { type: Number, default: null },
  selected:     { type: Boolean, default: false },
})

const emit = defineEmits(['select', 'edit', 'delete', 'crop', 'move'])

const allSources = inject('editor-sources', ref([]))

// Editor-wide context. Each has an inert default so the Welcome demos can render
// clips without providing any of it: no snapping, no scroll folding, editable.
const canvas   = inject('editor-canvas', ref(null))
const snap     = inject('editor-snap', null)
const readonly = inject('editor-readonly', ref(false))
const rejected = inject('editor-rejected', ref(null))
const group    = inject('editor-group', null)

const dragging   = ref(false)

const isEventTrack = computed(() => props.track.mode === 'event')

// A locked track (or a viewer without edit rights) is read-only: drags never
// start, so nothing moves under the pointer only to snap back when the editor
// refuses the mutation.
const locked = computed(() => !!props.track.isLocked || readonly.value)

// Narrow point marker: source-backed clips on clip-mode tracks only.
const isPoint = computed(() => !isEventTrack.value && props.clip.sourceId != null)

// ── Held geometry ─────────────────────────────────────────────────────────────
/*
 * `held` overrides the clip's position / mediaStart / end while a move or trim
 * is in progress — and after release, until the committed row arrives.
 *
 * Dropping the override on release would snap the clip back to where the drag
 * started and jump it forward a round trip later: a visible bounce on every
 * single drop, worse the further away the server is. So it stays until
 * `clip` reflects the write, then goes.
 *
 * Holding frames (not a px offset) keeps the clip in the right place if the
 * zoom changes while the request is in flight.
 *
 * Two failure paths release it early: the editor reporting the write was
 * refused (`editor-rejected`), and a timeout for a request that simply never
 * answers. Reverting is honest — it shows where the clip actually is.
 */
const HOLD_TIMEOUT_MS = 4000
const held = ref(null)
let _holdTimer = null

// While a multi-clip selection is dragged, every selected clip that isn't under
// the pointer follows the one that is, by the same number of frames.
const followDelta = computed(() => {
  const drag = group?.drag.value
  return drag && props.selected && drag.leaderId !== props.clip.id ? drag.delta : 0
})

const view = computed(() => {
  if (held.value) return { ...props.clip, ...held.value }
  if (followDelta.value) return { ...props.clip, position: props.clip.position + followDelta.value }
  return props.clip
})

function releaseHold() {
  held.value = null
  if (_holdTimer) { clearTimeout(_holdTimer); _holdTimer = null }
}

function holdUntilCommitted() {
  if (_holdTimer) clearTimeout(_holdTimer)
  _holdTimer = setTimeout(() => { _holdTimer = null; held.value = null }, HOLD_TIMEOUT_MS)
}

// A committed row (ours or a peer's) is the truth — unless the pointer is still
// down, in which case the drag keeps the clip until it is released.
watch([() => props.clip.position, () => props.clip.mediaStart, () => props.clip.end], () => {
  if (!dragging.value) releaseHold()
})
watch(rejected, (r) => {
  if (r?.clipId === props.clip.id && !dragging.value) releaseHold()
})

onBeforeUnmount(releaseHold)

const left = computed(() => clipLeft(view.value, props.timeline.startFrame, props.pxPerFrame))

const baseWidth = computed(() => {
  if (isEventTrack.value) {
    // Span to the frame before the next clip starts (or to timeline end)
    const nextStart = props.nextPosition ?? props.timeline.endFrame
    return Math.max(props.pxPerFrame, (nextStart - view.value.position) * props.pxPerFrame)
  }
  if (isPoint.value) return Math.max(2, props.pxPerFrame)
  return clipWidth(view.value, props.pxPerFrame)
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

// A clip with both a source and a custom label combines them ("K1 - Total shot").
const labelText = computed(() => {
  const short = source.value?.shortName
  if (short && props.clip.label) return `${short} - ${props.clip.label}`
  if (isEventTrack.value && source.value) return short
  return props.clip.label || props.track.name
})

// ── Snapping ──────────────────────────────────────────────────────────────────
// Targets are gathered once per drag (the editor excludes this clip itself).
// Holding Alt while dragging turns the pull off for fine placement.
let _targets = []
/** The clip's geometry when the pointer went down. */
let _origin = null
/** Ids moving together with this clip (a multi-clip selection), or null. */
let _group  = null
/** How far that group may move without any of it leaving the timeline. */
let _bounds = null

function beginGesture({ asGroup = false } = {}) {
  _origin  = { position: props.clip.position, mediaStart: props.clip.mediaStart, end: props.clip.end }
  _group   = asGroup && group ? group.membersFor(props.clip.id) : null
  _bounds  = _group ? group.deltaBounds(_group) : null
  // A group must not snap to where its own members started.
  _targets = snap ? snap.targets(_group ?? [props.clip.id]) : []
}

function showGuide(frame) {
  if (snap) snap.guide.value = frame
}

/** Frames of timeline the clip covers; 0 for points and event clips. */
function spanOf(geom) {
  if (isEventTrack.value || isPoint.value || geom.end == null) return 0
  return geom.end - (geom.mediaStart ?? 0)
}

// ── Drag to move ──────────────────────────────────────────────────────────────
let _didMove = false    // true once movement threshold is exceeded

function resolveMove(dx, event) {
  const { startFrame, endFrame } = props.timeline
  const len = spanOf(_origin)
  const raw = _origin.position + dx / props.pxPerFrame
  const { start, guide } = snap && !event.altKey
    ? snapSpan(_targets, raw, len, SNAP_PX / props.pxPerFrame)
    : { start: Math.round(raw), guide: null }
  let position
  if (_group) {
    // The whole selection moves by one delta; the bounds keep all of it on the timeline.
    position = _origin.position + clamp(start - _origin.position, _bounds.min, _bounds.max)
    group.drag.value = { leaderId: props.clip.id, delta: position - _origin.position }
  } else {
    // The whole clip stays on the timeline: past the end it would scroll out of
    // reach, with nothing left to grab it by.
    position = clamp(start, startFrame, Math.max(startFrame, endFrame - Math.max(1, len)))
  }
  showGuide(position === start ? guide : null)
  return position
}

const moveDrag = createDrag({
  scrollContainer: () => canvas.value,
  autoScroll: true,
  onStart: () => { beginGesture({ asGroup: true }) },
  onMove:  ({ dx, event }) => {
    // Dragging an unselected clip selects it — which also keeps it mounted if
    // auto-scroll carries it out of the lane's culling range. Dragging part of
    // a selection keeps the selection: that is the whole point of the gesture.
    if (!dragging.value && !_group) emit('select')
    _didMove = true
    dragging.value = true
    held.value = { position: resolveMove(dx, event) }
  },
  onEnd: ({ moved, cancelled }) => {
    const wasDragging = dragging.value
    dragging.value = false
    showGuide(null)
    if (!wasDragging) return   // a plain click: leave any pending hold alone

    const position = held.value?.position
    if (cancelled || !moved || position == null || position === props.clip.position) {
      releaseHold()
      if (_group) group.drag.value = null
      return
    }
    if (_group) {
      // The editor moves the whole selection locally inside this emit, so the
      // followers already stand where they were dropped when they stop following.
      emit('move', position)
      group.drag.value = null
      releaseHold()
      return
    }
    holdUntilCommitted()
    emit('move', position)
  },
})

function startMove(e) {
  _didMove = false
  // Ctrl/⌘- and Shift-clicks build a selection; they never pick the clip up.
  if (locked.value || e.ctrlKey || e.metaKey || e.shiftKey) return
  moveDrag(e)
}

// Click selects (a drag's trailing click doesn't): alone, or with Ctrl/⌘ to
// add/remove it, or with Shift for a range. Double-click opens the clip
// settings dialog, as does the context menu's "Edit".
function onClipClick(e) {
  if (_didMove) return
  emit('select', { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey })
}

function onClipDblClick() {
  if (_didMove) { _didMove = false; return }
  if (locked.value) return
  emit('edit')
}

// ── Trim (crop) drag ──────────────────────────────────────────────────────────
let _cropSide = null

// How much media the file really has, once its audio is decoded. Trimming the
// tail past it would only pad the clip with silence.
const mediaFrames = computed(() => {
  if (!pyramid.value) return Infinity
  return Math.floor(pyramid.value.duration * (parseFloat(props.timeline.frameRate) || 25))
})

function resolveCrop(dx, event) {
  const { startFrame, endFrame } = props.timeline
  const px        = props.pxPerFrame
  const snapOn    = !!snap && !event.altKey
  const threshold = SNAP_PX / px
  const pos = _origin.position
  const ms  = _origin.mediaStart ?? 0
  const me  = _origin.end ?? (ms + 1)

  if (_cropSide === 'left') {
    // Trimming the head moves the clip's start AND its media in-point by the
    // same amount: the audio stays exactly where it was on the timeline and
    // only the part before the new edge goes. Changing mediaStart alone would
    // slide the whole recording along under a clip that didn't move.
    let edge  = pos + dx / px
    const hit = snapOn ? nearestTarget(_targets, edge, threshold) : null
    if (hit != null) edge = hit
    // Not before the file's first frame, not before the timeline, not past the tail.
    const delta = clamp(Math.round(edge) - pos, Math.max(-ms, startFrame - pos), me - ms - 1)
    showGuide(hit != null && pos + delta === hit ? hit : null)
    return { position: pos + delta, mediaStart: ms + delta, end: me }
  }

  let edge  = pos + (me - ms) + dx / px
  const hit = snapOn ? nearestTarget(_targets, edge, threshold) : null
  if (hit != null) edge = hit
  // Not past the end of the file (a clip that is already longer keeps its
  // length) and not past the end of the timeline.
  const maxEnd = Math.min(Math.max(me, ms + mediaFrames.value), ms + (endFrame - pos))
  const end    = clamp(ms + Math.round(edge) - pos, ms + 1, Math.max(ms + 1, maxEnd))
  showGuide(hit != null && pos + (end - ms) === hit ? hit : null)
  return { position: pos, mediaStart: ms, end }
}

const cropDrag = createDrag({
  threshold: 0,
  scrollContainer: () => canvas.value,
  autoScroll: true,
  onStart: () => { dragging.value = true; beginGesture(); emit('select') },
  onMove:  ({ dx, event }) => { held.value = resolveCrop(dx, event) },
  onEnd:   ({ moved, cancelled }) => {
    dragging.value = false
    showGuide(null)
    const next = held.value
    const side = _cropSide
    _cropSide  = null
    if (cancelled || !moved || !next) { releaseHold(); return }

    const fields = {}
    if (side === 'left' && next.position !== _origin.position) {
      fields.position   = next.position
      fields.mediaStart = next.mediaStart
    }
    if (side === 'right' && next.end !== _origin.end) fields.end = next.end
    if (Object.keys(fields).length === 0) { releaseHold(); return }

    holdUntilCommitted()
    emit('crop', fields)
  },
})

function startCrop(side, e) {
  if (locked.value) return
  _cropSide = side
  cropDrag(e)
}

// ── Displayed geometry ────────────────────────────────────────────────────────
const displayedLeft  = computed(() => left.value)
const displayedWidth = computed(() => Math.max(2, baseWidth.value))

// Body rendering is class-based (tl-clip-*) off a --clip-hue variable, so the
// theme (`.dark`) picks appropriate lightness/chroma per display method.
const clipBodyClass = computed(() =>
  `tl-clip-${['normal', 'zebra', 'border', 'transparent'].includes(props.clipDisplay) ? props.clipDisplay : 'normal'}`,
)

const selectedClass = computed(() =>
  props.selected ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : '',
)

const bgStyle = computed(() => ({
  '--clip-hue': hue.value,
  left:   displayedLeft.value + 'px',
  width:  displayedWidth.value + 'px',
  cursor: locked.value ? 'default' : dragging.value ? 'grabbing' : 'grab',
  zIndex: dragging.value ? 30 : props.selected ? 20 : undefined,
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
  const canvasEl = waveCanvas.value
  const py       = pyramid.value
  const win      = visibleWindow.value
  if (!canvasEl || !py || !win) return

  const fps = parseFloat(props.timeline.frameRate)
  // The held geometry, so a trim in progress shows the audio it will keep.
  const ms  = view.value.mediaStart ?? 0
  const me  = view.value.end
  if (!me || me <= ms) return

  const dpr = window.devicePixelRatio || 1
  const W   = Math.max(1, win.width)
  const H   = Math.max(8, props.height - 8)  // clip is inset top-1/bottom-1 in the row
  canvasEl.width  = Math.round(W * dpr)
  canvasEl.height = Math.round(H * dpr)

  const ctx = canvasEl.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)

  // Pick the peak resolution that matches the current zoom.
  const samplesPerPixel = py.sampleRate / (props.pxPerFrame * fps)
  const level  = py.levels[pickLevel(py, samplesPerPixel)]
  const perBin = level.samplesPerBin
  const nBins  = level.min.length
  const mid    = H / 2

  const binAt = (px) => {
    const audioFrame = ms + (win.offset + px) / props.pxPerFrame
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
//
// Files already decoded (by playback, or another clip on the same file) come
// straight from the cache. The clip row itself is a dependency too: every add or
// edit replaces it, so a clip whose file failed to load, or whose fileType only
// just arrived, is evaluated again instead of staying blank until a reload.
watch(
  [() => props.clip.fileId, isAudioClip, () => visibleWindow.value !== null, () => props.clip],
  ([fileId, audio, visible], prev) => {
    // Another file — or a clip that is no longer audio — must not keep the old trace.
    if (prev && (fileId !== prev[0] || !audio)) pyramid.value = null
    if (!audio || !visible || pyramid.value) return
    getPeakPyramid(fileId)
      .then(p => { if (props.clip.fileId === fileId && isAudioClip.value) pyramid.value = p })
      .catch(() => {})
  },
  { immediate: true },
)

// Redraw on peaks ready, zoom, clip bounds (held or committed), or viewport
// scroll. Explicit deps avoid the reactivity gaps watchEffect can miss when
// props.clip is replaced with a fresh object after a PATCH.
watch(
  [waveCanvas, pyramid, visibleWindow, hue, faintBody,
   () => view.value.mediaStart, () => view.value.end,
   () => props.pxPerFrame, () => props.height],
  drawWaveform,
  { flush: 'post' },
)

// ── Media download state ──────────────────────────────────────────────────────
// The clip's file may be fetched from here (image) or from the playback
// scheduler well before this clip is on screen (audio); either way the transfer
// lands in the shared registry, so the same progress drives this clip's loading
// skin and the download island.
const isImageClip = computed(() => !!props.clip.fileId && props.clip.fileType === 'image')

const download    = useFileDownload(() => props.clip.fileId)
const isLoading   = computed(() => ['downloading', 'decoding'].includes(download.value?.status))
const loadFailed  = computed(() => download.value?.status === 'error')

// Decoding has no byte progress of its own — the bar sits full while the file
// is turned into an AudioBuffer rather than dropping back to zero.
const loadPercent = computed(() => {
  const entry = download.value
  if (!entry) return 0
  if (entry.status === 'decoding') return 100
  if (!entry.total) return 0
  return Math.min(100, Math.round((entry.loaded / entry.total) * 100))
})

// Only the clip knows what its file should be CALLED — register the label so a
// download the scheduler started on its own isn't listed as a bare id.
watch(
  [() => props.clip.fileId, labelText],
  ([fileId, label]) => {
    if (fileId) describeDownload(fileId, { name: label, kind: props.clip.fileType || 'file' })
  },
  { immediate: true },
)

// Image clips paint from a blob: URL instead of pointing <img> straight at the
// API, so the transfer is measurable — otherwise the browser would download it
// invisibly and the clip could show no progress at all.
const imageUrl = ref(null)
watch(
  [() => props.clip.fileId, isImageClip],
  ([fileId, isImage]) => {
    imageUrl.value = null
    if (!fileId || !isImage) return
    getMediaObjectUrl(fileId, { quality: 30, name: labelText.value, kind: 'image' })
      .then(url => { if (props.clip.fileId === fileId) imageUrl.value = url })
      .catch(() => {})
  },
  { immediate: true },
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
        :class="[isLoading ? 'animate-pulse' : '', selectedClass]"
        :style="bgStyle"
        @pointerdown="startMove"
        @click.stop="onClipClick"
        @dblclick.stop="onClipDblClick"
        @contextmenu="emit('select', { keep: true })"
      />

      <div
        v-else
        class="absolute top-1 bottom-1 rounded flex items-center overflow-hidden select-none touch-none"
        :class="[clipBodyClass, selectedClass]"
        :style="bgStyle"
        @pointerdown="startMove"
        @click.stop="onClipClick"
        @dblclick.stop="onClipDblClick"
        @contextmenu="emit('select', { keep: true })"
      >
        <!-- Left trim handle (clip-mode only) -->
        <div
          v-if="!isEventTrack && !locked"
          class="absolute left-0 top-0 bottom-0 w-1.5 z-20 cursor-col-resize bg-black/20 hover:bg-white/30 transition-colors rounded-l"
          @pointerdown.stop="startCrop('left', $event)"
        />

        <!-- Image background (image clips) — blob: URL, see the download watcher -->
        <img
          v-if="isImageClip && imageUrl"
          :src="imageUrl"
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
             Faint clip bodies use the theme foreground; solid bodies use white.

             The box is FIXED and `textLength` fits the glyphs to it, rather than
             the viewBox being sized to a guess at the text's natural width: any
             guess from the character count is wrong by whatever the font's real
             metrics are, and when it came up short the centred text ran past
             both edges and the SVG viewport clipped it. Letting the browser do
             the fitting is exact for every string and every font.
             `dominant-baseline="central"` centres on the em box, so ascenders
             and descenders clear the 40-unit height at font-size 26. -->
        <svg
          v-if="nameDisplay === 'stretch'"
          class="absolute inset-0 w-full h-full pointer-events-none z-10 px-1"
          :class="faintBody ? 'text-foreground/90' : ''"
          viewBox="0 0 100 40"
          preserveAspectRatio="none"
        >
          <text
            x="50" y="20"
            text-anchor="middle" dominant-baseline="central"
            textLength="100" lengthAdjust="spacingAndGlyphs"
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

        <!-- Media loading skin: shimmer over the body, byte progress along the
             bottom edge, spinner once the clip is wide enough to fit one.
             Paints above the label (later in DOM at the same z) but below the
             trim handles, and never takes pointer events. -->
        <div
          v-if="isLoading"
          class="absolute inset-0 z-10 pointer-events-none overflow-hidden rounded"
        >
          <div class="absolute inset-0 tl-clip-shimmer" :class="faintBody ? 'tl-clip-shimmer-faint' : ''" />
          <Spinner
            v-if="displayedWidth > 56"
            class="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5"
            :class="faintBody ? 'text-foreground/70' : 'text-white/85'"
          />
          <div class="absolute bottom-0 inset-x-0 h-[3px]" :class="faintBody ? 'bg-foreground/10' : 'bg-black/25'">
            <div
              class="h-full transition-[width] duration-200 ease-out"
              :class="faintBody ? 'bg-foreground/60' : 'bg-white/85'"
              :style="{ width: loadPercent + '%' }"
            />
          </div>
        </div>

        <!-- Media that never arrived — the clip is silent/blank for a reason -->
        <span
          v-else-if="loadFailed"
          class="absolute right-2 top-1/2 -translate-y-1/2 z-10 flex items-center"
          :title="download?.error || $t('editor.downloads.failed')"
        >
          <Icon icon="mdi:alert-circle" class="size-3.5 text-destructive" />
        </span>

        <!-- Right trim handle (clip-mode only) -->
        <div
          v-if="!isEventTrack && !locked"
          class="absolute right-0 top-0 bottom-0 w-1.5 z-20 cursor-col-resize bg-black/20 hover:bg-white/30 transition-colors rounded-r"
          @pointerdown.stop="startCrop('right', $event)"
        />
      </div>
    </ContextMenuTrigger>

    <ContextMenuContent>
      <ContextMenuItem v-if="locked" icon="mdi:lock" disabled>
        {{ readonly ? $t('editor.viewOnly') : $t('editor.locked') }}
      </ContextMenuItem>
      <template v-else>
        <ContextMenuItem icon="mdi:pencil-outline" @click="$emit('edit')">{{ $t('editor.clipMenu.edit') }}</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem icon="mdi:delete-outline" destructive @click="$emit('delete')">{{ $t('editor.clipMenu.delete') }}</ContextMenuItem>
      </template>
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

/* Loading sweep over a clip whose file is still coming down. Faint bodies
   (border/transparent) sweep in their own hue — a white sheen is invisible on
   the lane background. --clip-hue is inherited from the clip body. */
.tl-clip-shimmer {
  background-image: linear-gradient(100deg, transparent 25%, rgba(255, 255, 255, 0.22) 50%, transparent 75%);
  background-size: 220% 100%;
  animation: tl-clip-shimmer 1.3s linear infinite;
}
.tl-clip-shimmer-faint {
  background-image: linear-gradient(100deg, transparent 25%, oklch(60% 0.14 var(--clip-hue) / 0.3) 50%, transparent 75%);
}
@keyframes tl-clip-shimmer {
  from { background-position: 220% 0; }
  to   { background-position: -120% 0; }
}
</style>
