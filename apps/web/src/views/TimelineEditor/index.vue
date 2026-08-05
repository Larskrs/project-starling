<script setup>
import { ref, computed, provide, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { ResizeHandle, ConfirmDialog, useToast } from '@starling/ui'
import { useApi } from '../../composables/useApi'
import { usePageTitle } from '../../composables/usePageTitle'
import { useCookie } from '../../composables/useCookie'
import { useResizable } from '../../composables/useResizable'
import { clamp, framesToTC, sourceIndexFromKey, RULER_TICK_TARGET_PX } from './useEditorUtils'
import { createDrag } from './usePointerDrag'
import { useTimelineSync } from './useTimelineSync'
import { usePlayback } from './usePlayback'
import { destroyAudioEngine } from './useAudioEngine'
import { clearWaveformCache } from './useWaveform'
import { describeDownload, resetDownloads } from './mediaDownloads'
import { resolveTrackSettings, RULER_TRACK_HEIGHT, BPM_TRACK_HEIGHT, bpmAtFrame } from './behaviors/trackSettings'
import RulerLane       from './behaviors/RulerLane.vue'
import BpmLane         from './behaviors/BpmLane.vue'
import EditorToolbar   from './components/EditorToolbar.vue'
import Ruler           from './components/Ruler.vue'
import TrackHeader     from './components/TrackHeader.vue'
import TrackLane       from './components/TrackLane.vue'
import SourceBar       from './components/SourceBar.vue'
import DownloadToast   from './components/DownloadToast.vue'
import AddTrackDialog  from './components/AddTrackDialog.vue'
import TrackDialog     from './components/TrackDialog.vue'
import { useTimelineOpening } from '../../composables/useTimelineOpening'
import ClipDialog      from './components/ClipDialog.vue'
import BpmClipDialog   from './components/BpmClipDialog.vue'

const route      = useRoute()
const router     = useRouter()
const { t }      = useI18n()
const { $fetch } = useApi()
const toast      = useToast()

// ── Data ─────────────────────────────────────────────────────────────────────
const timeline   = ref(null)
const { describeOpening, finishOpening } = useTimelineOpening()

const trackList  = ref([])
const trackTypes = ref([])
const sources    = ref([])
const loading    = ref(true)
const error      = ref('')

const timelineUrl = computed(() => `/api/timeline/${route.params.tlId}`)
const trackUrl = (trackId) => `${timelineUrl.value}/tracks/${trackId}`
const clipUrl  = (clipId)  => `${timelineUrl.value}/clips/${clipId}`

async function load() {
  loading.value = true
  error.value   = ''
  const { ok, data } = await $fetch(timelineUrl.value, { silent: true })
  loading.value = false
  if (!ok) { error.value = t('editor.couldNotLoad'); finishOpening(); return }
  timeline.value   = data.timeline
  // Names the loading screen for anyone who arrived by pasted URL.
  describeOpening(data.timeline)
  trackList.value  = data.tracks
  trackTypes.value = data.trackTypes
  sources.value    = data.sources
  describeClipMedia()
  sync.join(route.params.tlId)
  nextTick(() => {
    // Restore the saved view for this timeline; otherwise the 5-minute default.
    const saved = savedViews.value[timeline.value.id]
    pxPerFrame.value = saved?.z
      ? clamp(saved.z, minPxPerFrame(), MAX_PX_PER_FRAME)
      : defaultPxPerFrame()
    nextTick(() => {
      if (saved?.s && canvasRef.value) canvasRef.value.scrollLeft = saved.s
      updateViewport()
      // Held until the view is restored, so the editor is never revealed
      // mid-scroll at the wrong zoom.
      finishOpening()
    })
  })
}

onMounted(load)

// Switching timeline without leaving the route reuses this component, so
// onMounted won't fire again. Without this the editor would keep the previous
// timeline's data and — worse — the loading screen would never be cleared.
watch(() => route.params.tlId, (id, prev) => { if (id && prev && id !== prev) load() })

/**
 * Names every clip's media file up front. The playback scheduler pulls audio in
 * on its own — often for clips that have never been on screen — so without this
 * pass those transfers would show in the download island as bare file ids.
 */
function describeClipMedia() {
  for (const track of trackList.value) {
    for (const clip of track.clips) {
      if (!clip.fileId) continue
      describeDownload(clip.fileId, { name: clip.label || track.name, kind: clip.fileType || 'file' })
    }
  }
}

usePageTitle(computed(() => timeline.value ? `${timeline.value.name} — ${t('editor.title')}` : null))

// ── Shared list mutations ─────────────────────────────────────────────────────
// Used by both local REST responses and remote socket events.

function upsertTrackLocal(track) {
  const i = trackList.value.findIndex(x => x.id === track.id)
  if (i !== -1) {
    const merged = { ...trackList.value[i], ...track, clips: track.clips ?? trackList.value[i].clips }
    trackList.value[i] = merged
    return merged
  }
  const added = { ...track, clips: track.clips ?? [] }
  trackList.value.push(added)
  return added
}

function removeTrackLocal(trackId) {
  trackList.value = trackList.value.filter(x => x.id !== trackId)
}

function upsertClipLocal(trackId, clip) {
  const track = trackList.value.find(x => x.id === trackId)
  if (!track) return null
  const i      = track.clips.findIndex(c => c.id === clip.id)
  const merged = i !== -1 ? { ...track.clips[i], ...clip } : clip
  if (i !== -1) track.clips[i] = merged
  else          track.clips.push(merged)
  track.clips.sort((a, b) => a.position - b.position)
  return merged
}

function removeClipLocal(trackId, clipId) {
  const track = trackList.value.find(x => x.id === trackId)
  if (track) track.clips = track.clips.filter(c => c.id !== clipId)
}

// ── Live sync ─────────────────────────────────────────────────────────────────
const sync = useTimelineSync({
  onClipChange(change) {
    if (change.type === 'upsert' && change.clip) upsertClipLocal(change.trackId, change.clip)
    if (change.type === 'remove' && change.clipId) removeClipLocal(change.trackId, change.clipId)
  },
  onTrackChange(change) {
    if (change.type === 'upsert' && change.track) upsertTrackLocal(change.track)
    if (change.type === 'remove' && change.trackId) removeTrackLocal(change.trackId)
    if (change.type === 'reorder' && Array.isArray(change.order)) applyTrackOrder(change.order)
  },
  onTransport(state) {
    playback.applyTransportState(state)
  },
})

// ── Zoom ──────────────────────────────────────────────────────────────────────
// Two input styles over one range (fit-whole-timeline … MAX_PX_PER_FRAME, so
// the range adapts to the timeline's length):
//  - wheel / pinch: CONTINUOUS exponential scaling, normalized per device and
//    coalesced to one zoom per frame — smooth on trackpads, sane per mouse notch
//  - toolbar buttons / keyboard: a ladder of ZOOM_STOPS geometric stops
// The default zoom puts ruler ticks at 5-minute intervals; the readout is the
// position in the range (0–100%), so the visible number stays small no matter
// how long the timeline is.
const MAX_PX_PER_FRAME = 16
const ZOOM_STOPS       = 50
const WHEEL_ZOOM_RATE  = 0.003   // exp factor per normalized wheel px

const pxPerFrame    = ref(1)      // set to the 5-minute-tick default once loaded
const timelineWidth = computed(() =>
  timeline.value ? (timeline.value.endFrame - timeline.value.startFrame) * pxPerFrame.value : 0,
)

function minPxPerFrame() {
  const frames = timeline.value ? timeline.value.endFrame - timeline.value.startFrame : 0
  const width  = canvasRef.value?.clientWidth || 1200
  return frames > 0 ? Math.min(width / frames, MAX_PX_PER_FRAME) : 0.01
}

// Default zoom: one ruler tick ≈ 5 minutes.
function defaultPxPerFrame() {
  const fps = parseFloat(timeline.value?.frameRate) || 25
  return clamp(RULER_TICK_TARGET_PX / (fps * 300), minPxPerFrame(), MAX_PX_PER_FRAME)
}

function setZoom(px, anchorClientX = null) {
  if (!timeline.value) return
  px = clamp(px, minPxPerFrame(), MAX_PX_PER_FRAME)
  if (px === pxPerFrame.value) return

  const canvas = canvasRef.value
  if (!canvas) { pxPerFrame.value = px; return }

  // Keep the frame under the anchor stationary: the cursor when given; else
  // the playhead while playing (auto-follow chases it anyway — centre-anchored
  // zoom would yank it off screen); else the viewport centre.
  let anchorX
  if (anchorClientX != null) {
    anchorX = anchorClientX - canvas.getBoundingClientRect().left
  } else {
    const playheadPx = (playheadFrame.value - timeline.value.startFrame) * pxPerFrame.value - canvas.scrollLeft
    anchorX = (isPlaying.value && playheadPx >= 0 && playheadPx <= canvas.clientWidth)
      ? playheadPx
      : canvas.clientWidth / 2
  }
  const anchorFrame = timeline.value.startFrame + (canvas.scrollLeft + anchorX) / pxPerFrame.value

  pxPerFrame.value = px

  nextTick(() => {
    canvas.scrollLeft = (anchorFrame - timeline.value.startFrame) * px - anchorX
    updateViewport()
  })
}

// The stop ladder, rebuilt on demand (its floor moves with the canvas width).
function zoomStops() {
  const min   = minPxPerFrame()
  const ratio = MAX_PX_PER_FRAME / min
  if (ratio <= 1) return [min]
  const stops = []
  for (let i = 0; i < ZOOM_STOPS; i++) stops.push(min * Math.pow(ratio, i / (ZOOM_STOPS - 1)))
  return stops
}

function nearestStopIndex(stops, px) {
  let best = 0, bestD = Infinity
  for (let i = 0; i < stops.length; i++) {
    const d = Math.abs(Math.log(stops[i] / px))
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

function stepZoom(steps, anchorClientX = null) {
  const stops = zoomStops()
  const i     = nearestStopIndex(stops, pxPerFrame.value)
  setZoom(stops[clamp(i + steps, 0, stops.length - 1)], anchorClientX)
}

const zoomIn    = () => stepZoom(1)
const zoomOut   = () => stepZoom(-1)
const zoomFit   = () => setZoom(minPxPerFrame())
const zoomReset = () => setZoom(defaultPxPerFrame())

// Toolbar readout: position on the zoom ladder — 0% = whole timeline, 100% = max.
const zoomLabel = computed(() => {
  if (!timeline.value) return ''
  const min   = minPxPerFrame()
  const ratio = MAX_PX_PER_FRAME / min
  if (ratio <= 1) return '100%'
  const pct = Math.round(100 * Math.log(pxPerFrame.value / min) / Math.log(ratio))
  return `${clamp(pct, 0, 100)}%`
})

// Browser zoom is disabled on the editor page: Ctrl/⌘+wheel (incl. trackpad
// pinch) zooms the timeline instead, anchored at the cursor when it's over the
// canvas. Continuous exponential scaling — deltas are normalized (line/page
// deltaModes → px, so mouse notches and pinches feel equivalent) and coalesced
// to one setZoom per animation frame, so a pinch burst costs one re-render.
// Safari's proprietary gesture events are swallowed for the same reason.
let _wheelFactor = 1
let _wheelAnchor = null
let _wheelRaf    = null

function onGlobalWheel(e) {
  if (!e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  const deltaPx = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1)
  _wheelFactor *= Math.exp(-deltaPx * WHEEL_ZOOM_RATE)
  if (canvasRef.value?.contains(e.target)) _wheelAnchor = e.clientX

  if (_wheelRaf) return
  _wheelRaf = requestAnimationFrame(() => {
    _wheelRaf = null
    const factor = _wheelFactor
    const anchor = _wheelAnchor
    _wheelFactor = 1
    _wheelAnchor = null
    setZoom(pxPerFrame.value * factor, anchor)
  })
}
const preventGesture = (e) => e.preventDefault()

onMounted(() => {
  document.addEventListener('wheel', onGlobalWheel, { passive: false })
  document.addEventListener('gesturestart', preventGesture)
  document.addEventListener('gesturechange', preventGesture)
})
onUnmounted(() => {
  document.removeEventListener('wheel', onGlobalWheel)
  document.removeEventListener('gesturestart', preventGesture)
  document.removeEventListener('gesturechange', preventGesture)
  if (_wheelRaf) { cancelAnimationFrame(_wheelRaf); _wheelRaf = null }
})

// ── Scroll sync + viewport ────────────────────────────────────────────────────
const canvasRef       = ref(null)
const trackHeadersRef = ref(null)

// Shared with EditorClip so each clip only rasterises the visible slice of its
// waveform. rAF-coalesced so a burst of scroll events yields one update/frame.
const viewport = ref({ scrollLeft: 0, width: 0 })
let _viewportRaf = null
function updateViewport() {
  if (_viewportRaf) return
  _viewportRaf = requestAnimationFrame(() => {
    _viewportRaf = null
    const el = canvasRef.value
    if (el) viewport.value = { scrollLeft: el.scrollLeft, width: el.clientWidth }
  })
}

function onCanvasScroll() {
  if (trackHeadersRef.value && canvasRef.value) {
    trackHeadersRef.value.scrollTop = canvasRef.value.scrollTop
  }
  updateViewport()
}

onMounted(() => window.addEventListener('resize', updateViewport))
onUnmounted(() => window.removeEventListener('resize', updateViewport))

// ── Per-timeline view memory (zoom + scroll) ─────────────────────────────────
// Reopening a timeline restores where you were instead of the 5-minute default.
const savedViews = useCookie('editor-views', {})   // tlId → { z: pxPerFrame, s: scrollLeft }

function saveView() {
  if (!timeline.value) return
  const entries = {
    ...savedViews.value,
    [timeline.value.id]: { z: pxPerFrame.value, s: Math.round(canvasRef.value?.scrollLeft ?? 0) },
  }
  // Keep the cookie small — drop the oldest entries beyond 20 timelines.
  const keys = Object.keys(entries)
  while (keys.length > 20) delete entries[keys.shift()]
  savedViews.value = entries
}

let _viewSaveTimer = null
watch([pxPerFrame, viewport], () => {
  if (loading.value || !timeline.value) return
  if (_viewSaveTimer) clearTimeout(_viewSaveTimer)
  _viewSaveTimer = setTimeout(saveView, 800)
})

// ── Track behavior settings (from track types) ────────────────────────────────
const settingsFor = (track) => resolveTrackSettings(track, trackTypes.value)

// Strip-display tracks (BPM + ruler strips): fixed slim height, not resizable.
const isStripTrack = (track) => ['ruler', 'bpm'].includes(settingsFor(track).trackDisplay)

// Display order mirrors the API: sortOrder, then createdAt. Strips order like
// any other track — no pinning.
const byOrder = (a, b) =>
  ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) ||
  (new Date(a.createdAt) - new Date(b.createdAt))

const orderedTracks = computed(() => [...trackList.value].sort(byOrder))

// Header badge: live BPM for metronome tracks; the active clip's label otherwise.
function headerBadge(track) {
  if (settingsFor(track).metronome) {
    const bpm = bpmAtFrame(track.clips, playheadFrame.value)
    return bpm ? `♩ ${bpm}` : '♩ —'
  }
  return activeClipLabel(track)
}

// The clip under the playhead: last clip at/before it, still running if it has
// a length (clip mode); event-mode clips stay active until the next clip.
function activeClip(track) {
  const frame = playheadFrame.value
  let active = null
  for (const clip of track.clips) {
    if (clip.position > frame) break
    active = clip
  }
  if (!active) return null
  if (active.end != null) {
    const len = active.end - (active.mediaStart ?? 0)
    if (frame >= active.position + len) return null
  }
  return active
}

function activeClipLabel(track) {
  const active = activeClip(track)
  if (!active) return ''
  // Matches the clip display: source short name prefixes a custom label.
  const short = active.sourceId ? sources.value.find(s => s.id === active.sourceId)?.shortName : null
  if (short && active.label) return `${short} - ${active.label}`
  return active.label || ''
}

// ── Client-local mute (cookie — never saved to the server) ────────────────────
const mutedTracks  = useCookie('editor-muted-tracks', {})   // trackId → true
const isTrackMuted = (track) => !!mutedTracks.value[track.id]

function toggleMute(track) {
  const next = { ...mutedTracks.value }
  if (next[track.id]) delete next[track.id]
  else next[track.id] = true
  mutedTracks.value = next
}

// ── Playback ──────────────────────────────────────────────────────────────────
const playback = usePlayback({
  timeline, trackList, trackTypes, mutedTracks, pxPerFrame, canvasRef,
  sendTransport: (...args) => sync.sendTransport(...args),
})
const {
  playheadFrame, playheadX, isPlaying,
  setPlayhead, seekStart, seekEnd, stopPlayback, togglePlayback,
} = playback

// ── Layout: sidebar width + per-track heights (persisted in cookies) ─────────
const TRACK_HEIGHT_DEFAULT = 56
const TRACK_HEIGHT_MIN     = 32
const TRACK_HEIGHT_MAX     = 256

const sidebarWidth = useCookie('editor-sidebar-width', 264)
const trackHeights = useCookie('editor-track-heights', {})   // trackId → px

function trackHeight(track) {
  const display = settingsFor(track).trackDisplay
  if (display === 'ruler') return RULER_TRACK_HEIGHT
  if (display === 'bpm')   return BPM_TRACK_HEIGHT
  return clamp(trackHeights.value[track.id] ?? TRACK_HEIGHT_DEFAULT, TRACK_HEIGHT_MIN, TRACK_HEIGHT_MAX)
}

const totalTracksHeight = computed(() =>
  trackList.value.reduce((sum, tr) => sum + trackHeight(tr), 0),
)

const sidebarResizer = useResizable({ axis: 'x', min: 200, max: 480 })
const rowResizer     = useResizable({ axis: 'y', min: TRACK_HEIGHT_MIN, max: TRACK_HEIGHT_MAX })

function startSidebarResize(e) {
  sidebarResizer.start(e, {
    value: sidebarWidth,
    // Canvas width changes with the sidebar — keep the waveform viewport fresh.
    set:   v => { sidebarWidth.value = v; updateViewport() },
    get:   () => sidebarWidth.value,
  })
}

function startRowResize(track, e) {
  rowResizer.start(e, {
    get: () => trackHeight(track),
    set: h => { trackHeights.value = { ...trackHeights.value, [track.id]: h } },
  })
}

// ── Track selection + source bar ──────────────────────────────────────────────
const selectedTrackId = ref(null)
const selectedTrack   = computed(() =>
  trackList.value.find(tr => tr.id === selectedTrackId.value) ?? null,
)

// The source bar shows when the selected track's type is bound to a source set.
const selectedTrackHasSourceSet = computed(() => {
  if (!selectedTrack.value) return false
  const tt = trackTypes.value.find(x => x.id === selectedTrack.value.typeId)
  return !!tt?.sourceSetId
})
const selectedTrackSources = computed(() =>
  selectedTrack.value ? getTrackSources(selectedTrack.value) : [],
)

// The take on air: the source of the selected track's clip under the playhead.
const activeSourceId = computed(() =>
  selectedTrack.value ? activeClip(selectedTrack.value)?.sourceId ?? null : null,
)

function selectTrack(track) {
  if (_suppressSelect) return
  selectedTrackId.value = selectedTrackId.value === track.id ? null : track.id
}

// ── Track reordering (drag headers vertically) ────────────────────────────────
// Dragging a header ≥5px vertically enters reorder mode; an insertion line
// tracks the pointer. Any track can be dropped at any position.
const reorderDrag = ref(null)   // { trackId, index } — insertion boundary in orderedTracks

const reorderIndicatorTop = computed(() => {
  if (!reorderDrag.value) return 0
  let y = 0
  for (let i = 0; i < reorderDrag.value.index; i++) y += trackHeight(orderedTracks.value[i])
  return y
})

function reorderBoundaryFromPointer(clientY) {
  const el  = trackHeadersRef.value
  const y   = clientY - el.getBoundingClientRect().top + el.scrollTop
  let acc = 0, idx = 0
  for (const tr of orderedTracks.value) {
    const h = trackHeight(tr)
    if (y < acc + h / 2) break
    acc += h
    idx++
  }
  return idx
}

// Swallows the click that follows a reorder drag so the drop doesn't toggle selection.
let _suppressSelect = false

const _reorderDrag = createDrag({
  threshold: 5,
  onMove: ({ event }, track) => {
    reorderDrag.value = { trackId: track.id, index: reorderBoundaryFromPointer(event.clientY) }
  },
  onEnd: ({ moved }, track) => {
    const drag = reorderDrag.value
    reorderDrag.value = null
    if (!moved || !drag) return
    _suppressSelect = true
    setTimeout(() => { _suppressSelect = false })
    commitTrackReorder(track, drag.index)
  },
})

function startTrackReorder(track, e) {
  if (trackList.value.length < 2) return
  _reorderDrag(e, track)
}

function commitTrackReorder(track, boundary) {
  const ids  = orderedTracks.value.map(tr => tr.id)
  const from = ids.indexOf(track.id)
  if (boundary === from || boundary === from + 1) return   // dropped back in place
  ids.splice(from, 1)
  ids.splice(boundary > from ? boundary - 1 : boundary, 0, track.id)
  reorderTracks(ids)
}

/** Applies an ordered id list to the local tracks' sortOrder (index = order). */
function applyTrackOrder(order) {
  const pos = new Map(order.map((id, i) => [id, i]))
  for (const tr of trackList.value) {
    const p = pos.get(tr.id)
    if (p != null) tr.sortOrder = p
  }
}

async function reorderTracks(order) {
  applyTrackOrder(order)   // optimistic; reload if the server disagrees
  const { ok, data } = await $fetch(`${timelineUrl.value}/tracks/reorder`, {
    method: 'POST', json: { order }, silent: true,
  })
  if (!ok) { load(); return }
  applyTrackOrder(data.order)
  sync.sendTrackChange({ type: 'reorder', order: data.order })
}

// Picking a source is often a blind keypress during a take — the clip lands at
// the playhead, which may be nowhere near the viewport. Flashing the chip is
// the only acknowledgement the operator gets, so it fires before the request.
const flashSourceId = ref(null)
let _flashTimer = null

function flashSource(sourceId) {
  flashSourceId.value = sourceId
  if (_flashTimer) clearTimeout(_flashTimer)
  _flashTimer = setTimeout(() => { flashSourceId.value = null }, 260)
}

/** Create a clip for `source` on the selected track at the playhead. */
async function addSourceClip(source) {
  const track = selectedTrack.value
  if (!track || blockedByLock(track)) return
  flashSource(source.id)
  const { ok, data } = await $fetch(`${timelineUrl.value}/clips`, {
    method: 'POST',
    json:   { trackId: track.id, position: Math.max(0, Math.round(playheadFrame.value)), sourceId: source.id },
    silent: true,
  })
  if (!ok) return
  upsertClipLocal(track.id, data)
  sync.sendClipChange({ type: 'upsert', trackId: track.id, clip: data })
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
function onKeydown(e) {
  // Ctrl/⌘ +/−/0 zoom the timeline, never the page — even while an input has
  // focus, so browser zoom stays disabled everywhere on the editor page.
  if (e.ctrlKey || e.metaKey) {
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); return }
    if (e.key === '-')                  { e.preventDefault(); zoomOut(); return }
    if (e.key === '0')                  { e.preventDefault(); zoomReset(); return }
  }
  const tag = e.target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return

  // Source switcher: 1…9 then 0 add a clip for the Nth source of the selected
  // track (number row or numpad). Bare digits only — Ctrl/⌘+digit belongs to
  // the browser, and a modifier held by accident shouldn't cut a take.
  if (selectedTrackHasSourceSet.value && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    const source = selectedTrackSources.value[sourceIndexFromKey(e)]
    if (source) { e.preventDefault(); addSourceClip(source); return }
  }

  // Bare +/− step the zoom ladder too — no modifier needed outside inputs.
  if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); return }
  if (e.key === '-')                  { e.preventDefault(); zoomOut(); return }
  // Ignore auto-repeat: holding space would otherwise machine-gun play/stop,
  // tearing down and restarting the run many times a second.
  if (e.code === 'Space')  { e.preventDefault(); if (!e.repeat) togglePlayback() }
  if (e.code === 'Home')   { e.preventDefault(); seekStart() }
  if (e.code === 'End')    { e.preventDefault(); seekEnd() }
  if (e.code === 'Escape') { selectedTrackId.value = null }
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    e.preventDefault()
    const step = (e.shiftKey ? 10 : 1) * (e.code === 'ArrowLeft' ? -1 : 1)
    setPlayhead(Math.round(playheadFrame.value) + step)
  }
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  if (_viewSaveTimer) clearTimeout(_viewSaveTimer)
  if (_flashTimer)    clearTimeout(_flashTimer)
  saveView()   // flush the debounced view save so the last zoom/scroll sticks
  stopPlayback(false)
  destroyAudioEngine()
  clearWaveformCache()
  resetDownloads()   // paired with the caches above: they hold these downloads' decoded results
  sync.leave()
})

// ── Ruler scrubbing ───────────────────────────────────────────────────────────
function frameFromPointer(e) {
  const rect = canvasRef.value.getBoundingClientRect()
  const x    = e.clientX - rect.left + canvasRef.value.scrollLeft
  return timeline.value.startFrame + x / pxPerFrame.value
}

function onScrubStart(e) {
  if (!canvasRef.value || !timeline.value) return
  setPlayhead(frameFromPointer(e))
  window.addEventListener('pointermove', onScrubMove)
  window.addEventListener('pointerup', onScrubEnd)
}
function onScrubMove(e) { setPlayhead(frameFromPointer(e)) }
function onScrubEnd() {
  window.removeEventListener('pointermove', onScrubMove)
  window.removeEventListener('pointerup', onScrubEnd)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Returns the sources belonging to a track's sourceSet (via its trackType).
function getTrackSources(track) {
  const tt = trackTypes.value.find(x => x.id === track.typeId)
  if (!tt?.sourceSetId) return []
  return sources.value.filter(s => s.sourceSetId === tt.sourceSetId)
}

// ── Track lock ────────────────────────────────────────────────────────────────
/**
 * True when the track is locked — and says so, once, on the way out.
 *
 * Every clip mutation funnels through here. The UI also disables the obvious
 * affordances, so this mostly catches the paths that have no affordance to
 * disable (source hotkeys) and anything reaching a track that a peer locked a
 * moment ago. The API enforces the same rule independently: a client that
 * hasn't received the lock yet would otherwise push an edit that live sync
 * relays to everyone.
 */
function blockedByLock(track) {
  if (!track?.isLocked) return false
  toast.warning(t('editor.trackLocked', { name: track.name }))
  return true
}

// ── Track mutations ───────────────────────────────────────────────────────────
const addTrackOpen = ref(false)

// A freshly created track comes back as the bare row, while the timeline
// payload joins its type's display fields onto every track. Decorating here
// keeps the list one shape, so a new track shows its colour and icon straight
// away instead of only after a reload.
function withTypeFields(track) {
  const tt = trackTypes.value.find(x => x.id === track.typeId)
  if (!tt) return track
  return {
    ...track,
    typeName:         tt.name,
    typeHue:          tt.hue,
    typeIcon:         tt.icon,
    typeTrackDisplay: tt.trackDisplay,
    typeNameDisplay:  tt.nameDisplay,
    typeClipDisplay:  tt.clipDisplay,
    typeMetronome:    tt.metronome,
    typeTts:          tt.tts,
  }
}

function onTrackAdded(track) {
  const added = upsertTrackLocal(withTypeFields(track))
  sync.sendTrackChange({ type: 'upsert', track: added })
}

async function patchTrack(track, json) {
  const { ok, data } = await $fetch(trackUrl(track.id), { method: 'PATCH', json, silent: true })
  if (!ok) return
  const merged = upsertTrackLocal({ ...data, id: track.id })
  sync.sendTrackChange({ type: 'upsert', track: merged })
}

const toggleLock = (track) => patchTrack(track, { isLocked: !track.isLocked })

// Per-track settings (name + icon override). The PATCH response carries only
// the track row, so it merges onto the joined type/source fields already held.
const trackDialog = ref({ open: false, track: null })

function openTrackSettings(track) {
  if (blockedByLock(track)) return
  trackDialog.value = { open: true, track }
}

function onTrackSaved(track) {
  const merged = upsertTrackLocal(track)
  sync.sendTrackChange({ type: 'upsert', track: merged })
}

// Deleting a track takes every clip with it — always confirm first.
const deleteTrackTarget = ref(null)
const deletingTrack     = ref(false)

async function confirmDeleteTrack() {
  const track = deleteTrackTarget.value
  if (!track) return
  if (blockedByLock(track)) { deleteTrackTarget.value = null; return }
  deletingTrack.value = true
  const { ok } = await $fetch(trackUrl(track.id), { method: 'DELETE', silent: true })
  deletingTrack.value     = false
  deleteTrackTarget.value = null
  if (!ok) return
  removeTrackLocal(track.id)
  if (selectedTrackId.value === track.id) selectedTrackId.value = null
  sync.sendTrackChange({ type: 'remove', trackId: track.id })
}

// ── Clip mutations ────────────────────────────────────────────────────────────
const clipDialog = ref({ open: false, track: null, clip: null, defaultPosition: 0, trackSources: [] })
const bpmDialog  = ref({ open: false, track: null, clip: null, defaultPosition: 0 })

function openAddClip(track) {
  if (blockedByLock(track)) return
  if (settingsFor(track).metronome) {
    bpmDialog.value = { open: true, track, clip: null, defaultPosition: Math.round(playheadFrame.value) }
    return
  }
  clipDialog.value = {
    open:            true,
    track,
    clip:            null,
    defaultPosition: Math.round(playheadFrame.value),
    trackSources:    getTrackSources(track),
  }
}
function openEditClip(track, clip) {
  if (blockedByLock(track)) return
  if (settingsFor(track).metronome) {
    bpmDialog.value = { open: true, track, clip, defaultPosition: clip.position }
    return
  }
  clipDialog.value = {
    open:            true,
    track,
    clip,
    defaultPosition: clip.position,
    trackSources:    getTrackSources(track),
  }
}

function onBpmClipSaved(clip) {
  const trackId = bpmDialog.value.track?.id
  if (!trackId) return
  const merged = upsertClipLocal(trackId, clip)
  if (merged) sync.sendClipChange({ type: 'upsert', trackId, clip: merged })
}
function closeClipDialog() {
  clipDialog.value = { ...clipDialog.value, open: false }
}

function onClipSaved(savedClip) {
  const trackId = clipDialog.value.track?.id
  if (!trackId) return
  const merged = upsertClipLocal(trackId, savedClip)
  if (merged) sync.sendClipChange({ type: 'upsert', trackId, clip: merged })
  closeClipDialog()
}

// The single choke point for clip edits (move, crop, dialog saves).
async function patchClip(track, clip, json) {
  if (blockedByLock(track)) return
  const { ok, data } = await $fetch(clipUrl(clip.id), {
    method: 'PATCH', json, silent: true,
  })
  if (!ok) return
  const merged = upsertClipLocal(track.id, { ...data, id: clip.id })
  if (merged) sync.sendClipChange({ type: 'upsert', trackId: track.id, clip: merged })
}

const moveClip = (track, clip, position) => patchClip(track, clip, { position })
const cropClip = (track, clip, fields)   => patchClip(track, clip, fields)

async function deleteClip(track, clip) {
  if (blockedByLock(track)) return
  const { ok } = await $fetch(clipUrl(clip.id), {
    method: 'DELETE', silent: true,
  })
  if (!ok) return
  removeClipLocal(track.id, clip.id)
  sync.sendClipChange({ type: 'remove', trackId: track.id, clipId: clip.id })
}

// ── Navigation ────────────────────────────────────────────────────────────────
function goBack() {
  stopPlayback(false)
  router.push(`/c/${route.params.cslug}/p/${route.params.pslug}/timelines`)
}

provide('editor-timeline',   timeline)
provide('editor-pxPerFrame', pxPerFrame)
provide('editor-playhead',   playheadFrame)
provide('editor-sources',    sources)
provide('editor-viewport',   viewport)
</script>

<template>
  <div class="relative flex flex-col h-dvh bg-background overflow-hidden">

    <!-- Loading is covered by TimelineLoadingScreen, raised in App.vue from the
         moment the route is entered — it outlives this component's chunk. -->
    <div v-if="error" class="flex-1 flex items-center justify-center">
      <p class="text-sm text-destructive">{{ error }}</p>
    </div>

    <!-- Editor -->
    <template v-else-if="timeline">

      <EditorToolbar
        :timeline="timeline"
        :zoom-label="zoomLabel"
        :playhead-frame="playheadFrame"
        :is-playing="isPlaying"
        :peers="sync.peers.value"
        :sync-connected="sync.connected.value"
        @go-back="goBack"
        @zoom-in="zoomIn"
        @zoom-out="zoomOut"
        @zoom-fit="zoomFit"
        @zoom-reset="zoomReset"
        @add-track="addTrackOpen = true"
        @toggle-play="togglePlayback"
        @seek-start="seekStart"
        @seek-end="seekEnd"
      />

      <div class="flex flex-1 overflow-hidden">

        <!-- Left panel: track headers -->
        <div
          class="shrink-0 border-r border-border flex flex-col overflow-hidden"
          :style="{ width: sidebarWidth + 'px' }"
        >
          <!-- Aligns with the ruler strip (h-8) across the divider -->
          <div class="h-8 shrink-0 border-b border-border bg-muted/40 flex items-center gap-1.5 px-3">
            <Icon icon="mdi:layers-triple-outline" class="size-3.5 text-muted-foreground shrink-0" />
            <span class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground truncate">
              {{ $t('editor.tracks') }}
            </span>
            <span class="ml-auto text-[11px] font-mono text-muted-foreground/70 tabular-nums shrink-0">
              {{ trackList.length }}
            </span>
          </div>

          <div ref="trackHeadersRef" class="flex-1 overflow-y-hidden relative">
            <!-- Reorder insertion line -->
            <div
              v-if="reorderDrag"
              class="absolute inset-x-0 h-0.5 -mt-px bg-primary z-10 pointer-events-none"
              :style="{ top: reorderIndicatorTop + 'px' }"
            />
            <TrackHeader
              v-for="track in orderedTracks"
              :key="track.id"
              :track="track"
              :height="trackHeight(track)"
              :selected="track.id === selectedTrackId"
              :badge="headerBadge(track)"
              :resizable="!isStripTrack(track)"
              :muted="isTrackMuted(track)"
              :class="reorderDrag?.trackId === track.id ? 'opacity-60' : ''"
              @select="selectTrack(track)"
              @reorder-start="startTrackReorder(track, $event)"
              @resize-start="startRowResize(track, $event)"
              @toggle-mute="toggleMute(track)"
              @toggle-lock="toggleLock(track)"
              @add-clip="openAddClip(track)"
              @settings="openTrackSettings(track)"
              @delete="deleteTrackTarget = track"
            />
            <div v-if="trackList.length === 0" class="px-4 py-6 text-xs text-muted-foreground text-center">
              {{ $t('editor.noTracks') }}
            </div>
          </div>

          <button
            class="shrink-0 border-t border-border px-3 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center gap-2 w-full"
            @click="addTrackOpen = true"
          >
            <Icon icon="mdi:plus" class="size-4 shrink-0" />
            {{ $t('editor.addTrack') }}
          </button>
        </div>

        <!-- Sidebar width resize handle -->
        <ResizeHandle
          axis="x"
          class="self-stretch -ml-0.5"
          :active="sidebarResizer.resizing.value"
          @pointerdown="startSidebarResize"
        />

        <!-- Right panel: canvas -->
        <div ref="canvasRef" class="flex-1 overflow-auto relative" @scroll="onCanvasScroll">
          <div :style="{ width: timelineWidth + 'px', minWidth: '100%', position: 'relative' }">

            <Ruler
              :timeline="timeline"
              :px-per-frame="pxPerFrame"
              :playhead-frame="playheadFrame"
              @scrub="onScrubStart"
            />

            <div class="relative" :style="{ minHeight: totalTracksHeight + 'px' }">
              <!-- Playhead line -->
              <div
                class="absolute top-0 bottom-0 w-px bg-primary/70 pointer-events-none z-10"
                :style="{ left: playheadX + 'px' }"
              />

              <template v-for="track in orderedTracks" :key="track.id">
                <BpmLane
                  v-if="settingsFor(track).trackDisplay === 'bpm'"
                  :track="track"
                  :timeline="timeline"
                  :px-per-frame="pxPerFrame"
                  :height="trackHeight(track)"
                  :selected="track.id === selectedTrackId"
                  :muted="isTrackMuted(track)"
                  @seek="setPlayhead($event)"
                  @edit-clip="openEditClip(track, $event)"
                  @delete-clip="deleteClip(track, $event)"
                  @move-clip="moveClip(track, $event.clip, $event.position)"
                />
                <RulerLane
                  v-else-if="settingsFor(track).trackDisplay === 'ruler'"
                  :track="track"
                  :timeline="timeline"
                  :px-per-frame="pxPerFrame"
                  :height="trackHeight(track)"
                  :selected="track.id === selectedTrackId"
                  :muted="isTrackMuted(track)"
                  @select="selectTrack(track)"
                  @edit-clip="openEditClip(track, $event)"
                  @delete-clip="deleteClip(track, $event)"
                  @move-clip="moveClip(track, $event.clip, $event.position)"
                />
                <TrackLane
                  v-else
                  :track="track"
                  :timeline="timeline"
                  :px-per-frame="pxPerFrame"
                  :height="trackHeight(track)"
                  :selected="track.id === selectedTrackId"
                  :muted="isTrackMuted(track)"
                  :name-display="settingsFor(track).nameDisplay"
                  :clip-display="settingsFor(track).clipDisplay"
                  @select="selectTrack(track)"
                  @edit-clip="openEditClip(track, $event)"
                  @delete-clip="deleteClip(track, $event)"
                  @crop-clip="cropClip(track, $event.clip, $event.fields)"
                  @move-clip="moveClip(track, $event.clip, $event.position)"
                />
              </template>

              <div v-if="trackList.length === 0" class="absolute inset-0 flex items-center justify-center">
                <p class="text-sm text-muted-foreground">{{ $t('editor.addTrackHint') }}</p>
              </div>
            </div>

          </div>
        </div>

      </div>

      <!-- Source switcher: floats bottom-center while a source-set track is selected -->
      <SourceBar
        v-if="selectedTrack && selectedTrackHasSourceSet"
        :track="selectedTrack"
        :sources="selectedTrackSources"
        :tc="framesToTC(playheadFrame, timeline.frameRate)"
        :active-source-id="activeSourceId"
        :flash-source-id="flashSourceId"
        @add="addSourceClip"
        @close="selectedTrackId = null"
      />

      <!-- Media download queue: appears on its own while files are in flight -->
      <DownloadToast />
    </template>

    <AddTrackDialog
      :open="addTrackOpen"
      :track-types="trackTypes"
      :timeline-id="route.params.tlId"
      @update:open="addTrackOpen = $event"
      @created="onTrackAdded"
    />

    <TrackDialog
      :open="trackDialog.open"
      :track="trackDialog.track"
      @update:open="trackDialog.open = $event"
      @saved="onTrackSaved"
    />

    <ClipDialog
      :open="clipDialog.open"
      :track="clipDialog.track"
      :clip="clipDialog.clip"
      :track-sources="clipDialog.trackSources"
      :default-position="clipDialog.defaultPosition"
      :timeline="timeline"
      @update:open="!$event && closeClipDialog()"
      @saved="onClipSaved"
    />

    <BpmClipDialog
      :open="bpmDialog.open"
      :track="bpmDialog.track"
      :clip="bpmDialog.clip"
      :default-position="bpmDialog.defaultPosition"
      @update:open="bpmDialog = { ...bpmDialog, open: $event }"
      @saved="onBpmClipSaved"
    />

    <ConfirmDialog
      :open="deleteTrackTarget !== null"
      :title="$t('editor.confirmDeleteTrackTitle')"
      :confirm-label="$t('editor.deleteTrack')"
      :cancel-label="$t('editor.cancel')"
      :loading="deletingTrack"
      destructive
      @confirm="confirmDeleteTrack"
      @cancel="deleteTrackTarget = null"
    >
      {{ $t('editor.confirmDeleteTrack', { name: deleteTrackTarget?.name }) }}
    </ConfirmDialog>

  </div>
</template>
