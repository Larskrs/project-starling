<script setup lang="ts">
import { ref, computed, provide, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { Button, ResizeHandle, ConfirmDialog, useToast } from '@starling/ui'
import { useApi } from '../../composables/useApi'
import { usePageTitle } from '../../composables/usePageTitle'
import { useLocalStorage } from '../../composables/useLocalStorage'
import { clamp, framesToTC, sourceIndexFromKey } from './lib/editorUtils'
import { useEditorViewport } from './view/useEditorViewport'
import { useEditorZoom } from './view/useEditorZoom'
import { useEditorLayout } from './view/useEditorLayout'
import { useEditorViewMemory } from './view/useEditorViewMemory'
import { createDrag } from './lib/pointerDrag'
import { combineEntries, createEditHistory, type HistoryEntry, type IdResolver } from './lib/editHistory'
import { buildSnapTargets } from './lib/snapping'
import { useTimelineSync } from './data/useTimelineSync'
import { usePlayback } from './audio/usePlayback'
import { destroyAudioEngine, setTrackVolume as applyTrackVolume } from './audio/useAudioEngine'
import { clearWaveformCache } from './audio/useWaveform'
import { describeDownload, resetDownloads } from './media/mediaDownloads'
import { resolveTrackSettings, trackSupportsAudio } from './behaviors/trackSettings'
import RulerLane       from './behaviors/RulerLane.vue'
import BpmLane         from './behaviors/BpmLane.vue'
import EditorToolbar   from './components/EditorToolbar.vue'
import DeviceRow       from './components/DeviceRow.vue'
import Ruler           from './components/Ruler.vue'
import TrackHeader     from './components/TrackHeader.vue'
import TrackLane       from './components/TrackLane.vue'
import SourceBar       from './components/SourceBar.vue'
import DownloadToast   from './components/DownloadToast.vue'
import AddTrackDialog  from './components/AddTrackDialog.vue'
import TrackDialog     from './components/TrackDialog.vue'
import ShortcutsDialog from './components/ShortcutsDialog.vue'
import { useTimelineOpening } from '../../composables/useTimelineOpening'
import ClipDialog      from './components/ClipDialog.vue'
import BpmClipDialog   from './components/BpmClipDialog.vue'
import type { Timeline } from '../../types/api'
import type {
  EditorClip, EditorTrack, Source, TimelineBootstrap, TrackType, TrackWithType,
} from '../../types/timeline'

const route      = useRoute()
const router     = useRouter()
const { t }      = useI18n()
const { $fetch } = useApi()
const toast      = useToast()

// ── Data ─────────────────────────────────────────────────────────────────────
const timeline   = ref<Timeline | null>(null)
const { describeOpening, finishOpening } = useTimelineOpening()

const trackList  = ref<EditorTrack[]>([])
const trackTypes = ref<TrackType[]>([])
const sources    = ref<Source[]>([])
const loading    = ref(true)
const error      = ref('')

/**
 * Whether this viewer may edit. A view-only member gets the editor without its
 * editing affordances rather than drags and menus the API would refuse. An
 * older payload without the flag is treated as editable — the API enforces it
 * regardless.
 */
const canEdit  = ref(true)
const readonly = computed(() => !canEdit.value)

const timelineUrl = computed(() => `/api/timeline/${route.params.tlId}`)
const trackUrl = (trackId: string) => `${timelineUrl.value}/tracks/${trackId}`
const clipUrl  = (clipId: string)  => `${timelineUrl.value}/clips/${clipId}`

function applyData(data: TimelineBootstrap): void {
  trackList.value  = data.tracks
  trackTypes.value = data.trackTypes
  sources.value    = data.sources
  canEdit.value    = data.canEdit !== false
  describeClipMedia()
}

async function load() {
  loading.value = true
  error.value   = ''
  // A different timeline: nothing selected or undoable carries over.
  cancelNudge()
  history.clear()
  selectedTrackId.value   = null
  selectedClipIds.value   = []
  selectionAnchorId.value = null

  const { ok, status, data } = await $fetch<TimelineBootstrap>(timelineUrl.value, { silent: true })
  loading.value = false
  if (!ok) {
    error.value = status === 404 ? t('editor.notFound')
      : status === 401 || status === 403 ? t('editor.noAccess')
      : t('editor.couldNotLoad')
    finishOpening()
    return
  }
  timeline.value   = data.timeline
  // Names the loading screen for anyone who arrived by pasted URL.
  describeOpening(data.timeline)
  applyData(data)
  sync.join(String(route.params.tlId))
  nextTick(() => {
    // Restore the saved view for this timeline; otherwise the 5-minute default.
    const saved = viewMemory.viewFor(timeline.value!.id)
    pxPerFrame.value = saved?.z
      ? clamp(saved.z, minPxPerFrame(), 16)
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

/**
 * Re-reads the timeline in place: after the live connection comes back (the
 * room does not replay what it relayed while we were gone), or when the server
 * refused an optimistic change.
 *
 * Unlike load() it keeps the view, playhead, selection and undo history.
 * `timeline` is patched rather than replaced — playback watches that ref and a
 * new object would throw the playhead back to the start.
 */
let _refreshing = false
async function refresh(): Promise<void> {
  if (_refreshing || !timeline.value) return
  _refreshing = true
  const { ok, data } = await $fetch<TimelineBootstrap>(timelineUrl.value, { silent: true })
  _refreshing = false
  if (!ok || !timeline.value || data.timeline.id !== timeline.value.id) return
  Object.assign(timeline.value, data.timeline)
  applyData(data)
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
      describeDownload(clip.fileId, {
        name: clip.label || track.name,
        kind: clip.fileType === 'image' || clip.fileType === 'audio' ? clip.fileType : 'file',
      })
    }
  }
}

usePageTitle(computed(() => timeline.value ? `${timeline.value.name} — ${t('editor.title')}` : null))

// ── Shared list mutations ─────────────────────────────────────────────────────
// Used by both local REST responses and remote socket events.

function upsertTrackLocal(track: EditorTrack): EditorTrack {
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

function removeTrackLocal(trackId: string): void {
  trackList.value = trackList.value.filter(x => x.id !== trackId)
}

/** The storage type of a file some other clip already knows, or null. */
function fileTypeOf(fileId: string): string | null {
  for (const track of trackList.value) {
    for (const clip of track.clips) {
      if (clip.fileId === fileId && clip.fileType) return clip.fileType
    }
  }
  return null
}

// fileId → storage type, for files no clip on the timeline knew the type of.
// A failed lookup is forgotten, so the clip's next change tries again.
const _fileTypeLookups = new Map<string, Promise<string | null>>()

function lookupFileType(fileId: string): Promise<string | null> {
  let lookup = _fileTypeLookups.get(fileId)
  if (!lookup) {
    lookup = $fetch<{ file: { type: string | null } }>(`/api/storage/${fileId}`, { silent: true })
      .then(res => {
        const type = res.ok ? res.data.file.type ?? null : null
        if (!type) _fileTypeLookups.delete(fileId)
        return type
      })
    _fileTypeLookups.set(fileId, lookup)
  }
  return lookup
}

/** Fills in a clip's missing fileType, so its waveform or image can load. */
async function resolveFileType(clipId: string, fileId: string): Promise<void> {
  const type = await lookupFileType(fileId)
  if (!type) return
  const found = findClip(clipId)
  // The clip may have been removed, or pointed at another file, meanwhile.
  if (!found || found.clip.fileId !== fileId || found.clip.fileType) return
  describeDownload(fileId, { kind: type === 'image' || type === 'audio' ? type : 'file' })
  upsertClipLocal(found.track.id, { ...found.clip, fileType: type })
}

function upsertClipLocal(trackId: string, clip: EditorClip): EditorClip | null {
  const track = trackList.value.find(x => x.id === trackId)
  if (!track) return null
  const i      = track.clips.findIndex(c => c.id === clip.id)
  const prev   = i !== -1 ? track.clips[i] : null
  const merged = { ...prev, ...clip } as EditorClip
  // Only the bootstrap joins fileType on. A relayed or freshly created row
  // arrives without it — and an audio clip with no fileType draws no waveform
  // — so borrow it from any clip already using the same file.
  if (clip.fileType === undefined && prev?.fileId !== merged.fileId) {
    merged.fileType = merged.fileId ? fileTypeOf(merged.fileId) : null
  }
  if (i !== -1) track.clips[i] = merged
  else          track.clips.push(merged)
  track.clips.sort((a, b) => a.position - b.position)
  // No clip to borrow from (a peer's new file, an undo back to a file nothing
  // else uses): ask storage, and the clip re-renders once the type is known.
  if (merged.fileId && !merged.fileType) void resolveFileType(merged.id, merged.fileId)
  return merged
}

function removeClipLocal(trackId: string, clipId: string): void {
  const track = trackList.value.find(x => x.id === trackId)
  if (track) track.clips = track.clips.filter(c => c.id !== clipId)
}

function findClip(clipId: string): { track: EditorTrack; clip: EditorClip } | null {
  for (const track of trackList.value) {
    const clip = track.clips.find(c => c.id === clipId)
    if (clip) return { track, clip }
  }
  return null
}

// ── Live sync ─────────────────────────────────────────────────────────────────
const sync = useTimelineSync({
  onClipChange(change) {
    if (change.type === 'upsert') upsertClipLocal(change.trackId, change.clip as unknown as EditorClip)
    if (change.type === 'remove') removeClipLocal(change.trackId, change.clipId)
  },
  onTrackChange(change) {
    if (change.type === 'upsert') upsertTrackLocal(change.track as unknown as EditorTrack)
    if (change.type === 'remove') removeTrackLocal(change.trackId)
    if (change.type === 'reorder') applyTrackOrder(change.order)
  },
  onTransport(state) {
    playback.applyTransportState(state)
  },
  onReconnect() {
    refresh()
  },
})

// ── View: viewport, zoom, layout ─────────────────────────────────────────────
const { canvasRef, trackHeadersRef, viewport, updateViewport, onCanvasScroll } = useEditorViewport()

const {
  pxPerFrame, timelineWidth, zoomLabel,
  minPxPerFrame, defaultPxPerFrame,
  zoomIn, zoomOut, zoomFit, zoomReset,
} = useEditorZoom({
  timeline, canvasRef, updateViewport,
  // Playback owns the transport state but is created below — it needs
  // pxPerFrame from here. Passed as getters so nothing is read during setup.
  playheadFrame: () => playheadFrame.value,
  isPlaying:     () => isPlaying.value,
})

const viewMemory = useEditorViewMemory({ timeline, loading, pxPerFrame, viewport, canvasRef })

/**
 * The track headers never scroll on their own (they mirror the canvas), so a
 * wheel over them used to do nothing at all. Hand it to the canvas instead.
 * Modified wheels are left alone: those are zoom gestures, handled globally.
 */
function onHeadersWheel(e: WheelEvent): void {
  const canvas = canvasRef.value
  if (!canvas || e.ctrlKey || e.metaKey || e.altKey) return
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1
  canvas.scrollTop  += e.deltaY * unit
  canvas.scrollLeft += e.deltaX * unit
}

/**
 * The API-account footer under the track headers takes height from that column
 * alone. The canvas reserves the same height below its lanes; otherwise it
 * scrolls further than the headers can follow and the bottom rows drift apart.
 * Observed rather than fixed: accounts come and go, and many wrap to more lines.
 */
const deviceFooterRef    = ref<HTMLElement | null>(null)
const deviceFooterHeight = ref(0)

const footerObserver = typeof ResizeObserver === 'undefined'
  ? null
  : new ResizeObserver(() => { deviceFooterHeight.value = deviceFooterRef.value?.offsetHeight ?? 0 })

watch(deviceFooterRef, (el, prev) => {
  if (prev) footerObserver?.unobserve(prev)
  if (el) footerObserver?.observe(el)
  deviceFooterHeight.value = el?.offsetHeight ?? 0
})
onUnmounted(() => footerObserver?.disconnect())

// ── Track behavior settings (from track types) ────────────────────────────────
const settingsFor = (track: TrackWithType) => resolveTrackSettings(track, trackTypes.value)

// Strip-display tracks (BPM + ruler strips): fixed slim height, not resizable.
const isStripTrack = (track: EditorTrack) => ['ruler', 'bpm'].includes(settingsFor(track).trackDisplay)

// Display order mirrors the API: sortOrder, then createdAt. Strips order like
// any other track — no pinning.
const byOrder = (a: EditorTrack, b: EditorTrack) =>
  ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) ||
  (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

const orderedTracks = computed(() => [...trackList.value].sort(byOrder))

// The clip under the playhead: last clip at/before it, still running if it has
// a length (clip mode); event-mode clips stay active until the next clip.
function activeClip(track: EditorTrack): EditorClip | null {
  const frame = playheadFrame.value
  let active: EditorClip | null = null
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

// ── Client-local mute + volume (localStorage — never saved to the server) ─────
// Both are per-viewer: two people editing the same timeline mix it to their own
// taste without fighting over each other's levels.
const mutedTracks  = useLocalStorage<Record<string, true>>('editor-muted-tracks', {})   // trackId → true
const trackVolumes = useLocalStorage<Record<string, number>>('editor-track-volumes', {}) // trackId → 0..1

const isTrackMuted = (track: EditorTrack) => !!mutedTracks.value[track.id]

/** A track with no stored level is at unity, not silent. */
const trackVolume = (track: EditorTrack): number =>
  clamp(trackVolumes.value[track.id] ?? 1, 0, 1)

/** Whether this track can make sound — decides mute-vs-hide for its control. */
const supportsAudio = (track: EditorTrack): boolean =>
  trackSupportsAudio(track, trackTypes.value)

/**
 * A track with no audio that has been switched off. Its toggle shows an eye, so
 * it has to actually hide something: the lane is made invisible rather than
 * unmounted, which keeps its row box — and therefore the header/lane alignment
 * — exactly as it was.
 */
const isTrackHidden = (track: EditorTrack): boolean =>
  isTrackMuted(track) && !supportsAudio(track)

function toggleMute(track: EditorTrack): void {
  const next = { ...mutedTracks.value }
  if (next[track.id]) delete next[track.id]
  else next[track.id] = true
  mutedTracks.value = next
}

function setTrackVolume(track: EditorTrack, volume: number): void {
  const v = clamp(volume, 0, 1)
  // Unity is the default, so storing it would just grow the entry for nothing.
  const next = { ...trackVolumes.value }
  if (v === 1) delete next[track.id]
  else next[track.id] = v
  trackVolumes.value = next
  // Apply to the live run immediately — a slider that only takes effect on the
  // next play is not a mixer.
  applyTrackVolume(track.id, v)
}

// ── Playback ──────────────────────────────────────────────────────────────────
/**
 * Live (the room's shared transport) or local (a private playhead). The toolbar
 * toggle picks it; every transport control — play, seek, scrub, Home/End —
 * then acts on that one. Per viewer and remembered, like the mix.
 */
const transportLive = useLocalStorage<boolean>('editor-transport-live', true)

const playback = usePlayback({
  timeline, trackList, trackTypes, mutedTracks, trackVolumes, pxPerFrame, canvasRef,
  sendTransport: (...args) => sync.sendTransport(...args),
  live: transportLive,
})
const {
  playheadFrame, playheadX, isPlaying, audioBlocked, roomPlaying,
  setPlayhead, seekStart, seekEnd, stopPlayback, togglePlayback, setLiveMode,
} = playback

watch(sync.connected, (connected) => { if (!connected) playback.clearRoomState() })

// ── Layout ────────────────────────────────────────────────────────────────────
/** The add-track row under the bottom track header; the canvas reserves the same height. */
const ADD_TRACK_ROW_PX = 36

const {
  sidebarWidth, trackHeight, totalTracksHeight,
  sidebarResizer, startSidebarResize, startRowResize,
} = useEditorLayout({ tracks: trackList, settingsFor, onSidebarResize: updateViewport })

// ── Selection: track + clip ───────────────────────────────────────────────────
const selectedTrackId = ref<string | null>(null)
const selectedTrack   = computed(() =>
  trackList.value.find(tr => tr.id === selectedTrackId.value) ?? null,
)

/**
 * Selected clips — what Delete, nudging and dragging act on. Ctrl/⌘-click adds
 * or removes one; Shift-click selects a range from the anchor (the last clip
 * clicked without Shift). Ids of clips a peer deleted are simply not found.
 */
const selectedClipIds   = ref<string[]>([])
const selectionAnchorId = ref<string | null>(null)
const selectedClips = computed(() =>
  selectedClipIds.value
    .map(id => findClip(id))
    .filter((x): x is { track: EditorTrack; clip: EditorClip } => x !== null),
)

interface ClipSelectMods {
  /** Ctrl/⌘: add or remove this clip. */
  toggle?: boolean
  /** Shift: everything between the anchor and this clip. */
  range?: boolean
  /** Right-click: leave an existing selection that contains this clip alone. */
  keep?: boolean
}

// The source bar shows when the selected track's type is bound to a source set.
const selectedTrackHasSourceSet = computed(() => {
  if (!selectedTrack.value) return false
  const tt = trackTypes.value.find(x => x.id === selectedTrack.value!.typeId)
  return !!tt?.sourceSetId
})
const selectedTrackSources = computed(() =>
  selectedTrack.value ? getTrackSources(selectedTrack.value) : [],
)

// The take on air: the source of the selected track's clip under the playhead.
const activeSourceId = computed(() =>
  selectedTrack.value ? activeClip(selectedTrack.value)?.sourceId ?? null : null,
)

/**
 * `toggle` is for the track header, where clicking a selected track again is
 * the natural way to let go of it. Clicks in a lane only ever select: a stray
 * click during a live take must not close the source switcher mid-shot.
 */
function selectTrack(track: EditorTrack, { toggle = false } = {}): void {
  if (_suppressSelect) return
  selectedTrackId.value = toggle && selectedTrackId.value === track.id ? null : track.id
}

function onLaneClick(track: EditorTrack): void {
  selectedClipIds.value = []
  selectTrack(track)
}

function selectClip(clip: EditorClip, { toggle = false, range = false, keep = false }: ClipSelectMods = {}): void {
  const ids = selectedClipIds.value
  if (range && selectionAnchorId.value && findClip(selectionAnchorId.value)) {
    const run = clipsInRange(selectionAnchorId.value, clip.id)
    // Ctrl/⌘+Shift adds the range to what is already selected. The anchor
    // stays put, so further Shift-clicks re-draw the range from the same clip.
    selectedClipIds.value = toggle ? [...new Set([...ids, ...run])] : run
    return
  }
  if (toggle) {
    selectedClipIds.value   = ids.includes(clip.id) ? ids.filter(id => id !== clip.id) : [...ids, clip.id]
    selectionAnchorId.value = clip.id
    return
  }
  // Right-clicking inside a selection keeps it, so its menu acts on all of it.
  if (keep && ids.includes(clip.id)) return
  selectedClipIds.value   = [clip.id]
  selectionAnchorId.value = clip.id
}

/**
 * Shift-click: every clip whose position lies between the anchor clip's and the
 * clicked clip's (inclusive), on the rows from the anchor's track to the clicked
 * one's. Both on one track — the usual case — is a plain run along that track.
 * Hidden tracks are skipped: nothing invisible gets selected.
 */
function clipsInRange(anchorId: string, targetId: string): string[] {
  const a = findClip(anchorId)
  const b = findClip(targetId)
  if (!a || !b) return [targetId]
  const rows = orderedTracks.value
  const ia   = rows.findIndex(tr => tr.id === a.track.id)
  const ib   = rows.findIndex(tr => tr.id === b.track.id)
  const lo   = Math.min(a.clip.position, b.clip.position)
  const hi   = Math.max(a.clip.position, b.clip.position)
  const out: string[] = []
  for (const track of rows.slice(Math.min(ia, ib), Math.max(ia, ib) + 1)) {
    if (isTrackHidden(track)) continue
    for (const clip of track.clips) {
      if (clip.position >= lo && clip.position <= hi) out.push(clip.id)
    }
  }
  return out
}

/** Ctrl/⌘+A: every clip on the selected track, or on every visible track. */
function selectAllClips(): void {
  const tracks = selectedTrack.value ? [selectedTrack.value] : orderedTracks.value.filter(tr => !isTrackHidden(tr))
  selectedClipIds.value   = tracks.flatMap(tr => tr.clips.map(c => c.id))
  selectionAnchorId.value = null
}

// ── Track reordering (drag headers vertically) ────────────────────────────────
// Dragging a header ≥5px vertically enters reorder mode; an insertion line
// tracks the pointer. Any track can be dropped at any position.
const reorderDrag = ref<{ trackId: string; index: number } | null>(null)   // insertion boundary in orderedTracks

const reorderIndicatorTop = computed(() => {
  if (!reorderDrag.value) return 0
  let y = 0
  for (let i = 0; i < reorderDrag.value.index; i++) y += trackHeight(orderedTracks.value[i])
  return y
})

function reorderBoundaryFromPointer(clientY: number): number {
  const el  = trackHeadersRef.value
  if (!el) return 0
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

const _reorderDrag = createDrag<EditorTrack>({
  threshold: 5,
  // Vertical only: a few px of sideways wobble on a click is not a reorder,
  // and treating it as one swallowed the click that should have selected.
  axis: 'y',
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

function startTrackReorder(track: EditorTrack, e: PointerEvent): void {
  if (readonly.value || trackList.value.length < 2) return
  _reorderDrag(e, track)
}

function commitTrackReorder(track: EditorTrack, boundary: number): void {
  const ids  = orderedTracks.value.map(tr => tr.id)
  const from = ids.indexOf(track.id)
  if (boundary === from || boundary === from + 1) return   // dropped back in place
  ids.splice(from, 1)
  ids.splice(boundary > from ? boundary - 1 : boundary, 0, track.id)
  reorderTracks(ids)
}

/** Applies an ordered id list to the local tracks' sortOrder (index = order). */
function applyTrackOrder(order: string[]): void {
  const pos = new Map(order.map((id, i) => [id, i]))
  for (const tr of trackList.value) {
    const p = pos.get(tr.id)
    if (p != null) tr.sortOrder = p
  }
}

async function reorderTracks(order: string[]): Promise<void> {
  applyTrackOrder(order)   // optimistic; re-read if the server disagrees
  const { ok, data } = await $fetch<{ order: string[] }>(`${timelineUrl.value}/tracks/reorder`, {
    method: 'POST', json: { order },
  })
  if (!ok) { refresh(); return }
  applyTrackOrder(data.order)
}

// Picking a source is often a blind keypress during a take — the clip lands at
// the playhead, which may be nowhere near the viewport. Flashing the chip is
// the only acknowledgement the operator gets, so it fires before the request.
const flashSourceId = ref<string | null>(null)
let _flashTimer: ReturnType<typeof setTimeout> | null = null

function flashSource(sourceId: string): void {
  flashSourceId.value = sourceId
  if (_flashTimer) clearTimeout(_flashTimer)
  _flashTimer = setTimeout(() => { flashSourceId.value = null }, 260)
}

/** Create a clip for `source` on the selected track at the playhead. */
async function addSourceClip(source: Source): Promise<void> {
  const track = selectedTrack.value
  if (!track || !timeline.value || cannotEdit(track)) return
  flashSource(source.id)
  const position = clamp(Math.round(playheadFrame.value), timeline.value.startFrame, timeline.value.endFrame - 1)
  const { ok, data } = await $fetch<EditorClip>(`${timelineUrl.value}/clips`, {
    method: 'POST',
    json:   { trackId: track.id, position: Math.max(0, position), sourceId: source.id },
  })
  if (!ok) return
  const clip = upsertClipLocal(track.id, data)
  if (clip) history.push(clipCreateEntry(track.id, clip))
}

// ── Snapping ──────────────────────────────────────────────────────────────────
// Drags ask for targets once, when they start. The guide is the frame the drag
// last snapped to, drawn as a line across every lane.
const snapGuide = ref<number | null>(null)

const snapGuideX = computed(() =>
  snapGuide.value == null || !timeline.value
    ? null
    : (snapGuide.value - timeline.value.startFrame) * pxPerFrame.value,
)

/** Targets for a drag of the clips in `exclude` — they never snap to themselves. */
function snapTargets(exclude: string[]): number[] {
  const skip = new Set(exclude)
  const tl = timeline.value
  const frames: number[] = [playheadFrame.value]
  if (tl) frames.push(tl.startFrame, tl.endFrame)
  for (const track of trackList.value) {
    for (const clip of track.clips) {
      if (skip.has(clip.id)) continue
      frames.push(clip.position)
      if (track.mode !== 'event' && clip.sourceId == null && clip.end != null) {
        frames.push(clip.position + clip.end - (clip.mediaStart ?? 0))
      }
    }
  }
  return buildSnapTargets(frames)
}

// ── Undo / redo ───────────────────────────────────────────────────────────────
// Clip edits only — creation, deletion, move, trim, dialog saves, nudges. Track
// deletion is guarded by a confirmation instead; restoring a whole track with
// every clip on it is a different undertaking.
const canUndo = ref(false)
const canRedo = ref(false)

const history = createEditHistory({
  onChange: (state) => { canUndo.value = state.canUndo; canRedo.value = state.canRedo },
})

/** The fields a clip edit can change — what undo snapshots and puts back. */
const CLIP_FIELDS = ['position', 'mediaStart', 'end', 'label', 'hue', 'sourceId', 'fileId', 'data'] as const
type ClipFields = Partial<Pick<EditorClip, typeof CLIP_FIELDS[number]>>

function pickClipFields(clip: EditorClip, keys: readonly string[] = CLIP_FIELDS): ClipFields {
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    if (!(CLIP_FIELDS as readonly string[]).includes(key)) continue
    const value = clip[key as keyof EditorClip] ?? null
    // `data` is a reactive object: snapshot a plain copy of it as it is now.
    out[key] = key === 'data' && value ? JSON.parse(JSON.stringify(value)) : value
  }
  return out as ClipFields
}

/** Lets the clip under edit know the write didn't land, so it stops holding it. */
const rejectedEdit = ref<{ clipId: string } | null>(null)
const rejectEdit = (clipId: string): void => { rejectedEdit.value = { clipId } }

function clipPatchEntry(trackId: string, clipId: string, before: ClipFields, after: ClipFields): HistoryEntry {
  const apply = (fields: ClipFields) => async (ids: IdResolver): Promise<boolean> => {
    const id    = ids.resolve(clipId)
    const found = findClip(id)
    if (found && cannotEdit(found.track)) return false
    const { ok, data } = await $fetch<EditorClip>(clipUrl(id), { method: 'PATCH', json: fields })
    if (!ok) return false
    upsertClipLocal(found?.track.id ?? trackId, { ...data, id })
    return true
  }
  return { undo: apply(before), redo: apply(after) }
}

async function removeClipRemote(trackId: string, clipId: string): Promise<boolean> {
  const { ok, status, error: err } = await $fetch(clipUrl(clipId), { method: 'DELETE', silent: true })
  // Already gone — a peer got there first — is exactly the state asked for.
  if (!ok && status !== 404) { toast.error(err); return false }
  removeClipLocal(trackId, clipId)
  selectedClipIds.value = selectedClipIds.value.filter(id => id !== clipId)
  return true
}

async function recreateClip(trackId: string, snapshot: EditorClip, ids: IdResolver): Promise<boolean> {
  const { ok, data } = await $fetch<EditorClip>(`${timelineUrl.value}/clips`, {
    method: 'POST',
    json:   { trackId, ...pickClipFields(snapshot) },
  })
  if (!ok) return false
  // The restored row has a new id: older entries naming the old one follow it.
  ids.alias(ids.resolve(snapshot.id), data.id)
  upsertClipLocal(trackId, { ...data, fileType: snapshot.fileType ?? null })
  return true
}

function clipCreateEntry(trackId: string, clip: EditorClip): HistoryEntry {
  const snapshot = { ...clip, ...pickClipFields(clip) } as EditorClip
  return {
    undo: (ids) => removeClipRemote(trackId, ids.resolve(snapshot.id)),
    redo: (ids) => recreateClip(trackId, snapshot, ids),
  }
}

function clipDeleteEntry(trackId: string, clip: EditorClip): HistoryEntry {
  const created = clipCreateEntry(trackId, clip)
  return { undo: created.redo, redo: created.undo }
}

async function undo(): Promise<void> {
  if (readonly.value) return
  await flushNudge()
  history.undo()
}

async function redo(): Promise<void> {
  if (readonly.value) return
  await flushNudge()
  history.redo()
}

// ── Moving several clips at once ──────────────────────────────────────────────
interface PositionMove { trackId: string; clipId: string; from: number; to: number }

/** Frames a clip covers on the timeline; 0 for event clips and point markers. */
function clipSpan(track: EditorTrack, clip: EditorClip): number {
  return track.mode === 'event' || clip.sourceId != null || clip.end == null
    ? 0
    : clip.end - (clip.mediaStart ?? 0)
}

/** How far a set of clips can move together without any of it leaving the timeline. */
function deltaBoundsFor(items: { clipId: string; from: number }[]): { min: number; max: number } {
  const tl = timeline.value
  if (!tl) return { min: 0, max: 0 }
  let min = -Infinity
  let max = Infinity
  for (const { clipId, from } of items) {
    const found = findClip(clipId)
    if (!found) continue
    min = Math.max(min, tl.startFrame - from)
    max = Math.min(max, tl.endFrame - Math.max(1, clipSpan(found.track, found.clip)) - from)
  }
  // Staying put is always allowed, even for a clip already sitting out of range.
  return { min: Math.min(min, 0), max: Math.max(max, 0) }
}

/**
 * The selection being dragged: which clip is under the pointer and how far it
 * has moved. Every other selected clip reads this and follows.
 */
const groupDrag = ref<{ leaderId: string; delta: number } | null>(null)

/** The ids that move with `clipId` — the selection, when it holds it and more. */
function groupMembersFor(clipId: string): string[] | null {
  const ids = selectedClips.value.map(({ clip }) => clip.id)
  return ids.length > 1 && ids.includes(clipId) ? ids : null
}

function groupDeltaBounds(ids: string[]): { min: number; max: number } {
  return deltaBoundsFor(ids.flatMap(id => {
    const found = findClip(id)
    return found ? [{ clipId: id, from: found.clip.position }] : []
  }))
}

/** A lone locked track among the selection blocks the whole group edit. */
function selectionBlocked(items: { track: EditorTrack }[]): boolean {
  if (readonly.value) return true
  const locked = items.find(({ track }) => track.isLocked)
  return locked ? blockedByLock(locked.track) : false
}

/** Applies position changes locally right away, then writes them. */
function applyPositions(moves: PositionMove[]): void {
  for (const move of moves) {
    const found = findClip(move.clipId)
    if (found) upsertClipLocal(found.track.id, { ...found.clip, position: move.to })
  }
}

/**
 * Writes position changes already applied locally. Every clip that lands goes
 * into ONE undo step; any the server refuses is put back where it was, with a
 * single toast rather than one per clip.
 */
async function commitPositions(moves: PositionMove[]): Promise<void> {
  if (!moves.length) return
  const results = await Promise.all(moves.map(m =>
    $fetch<EditorClip>(clipUrl(m.clipId), { method: 'PATCH', json: { position: m.to }, silent: true })))

  const landed: HistoryEntry[] = []
  let failure = ''
  for (let i = 0; i < moves.length; i++) {
    const move    = moves[i]!
    const result  = results[i]!
    const current = findClip(move.clipId)
    if (result.ok) {
      upsertClipLocal(current?.track.id ?? move.trackId, { ...result.data, id: move.clipId })
      landed.push(clipPatchEntry(move.trackId, move.clipId, { position: move.from }, { position: move.to }))
    } else {
      failure ||= result.error
      if (current) upsertClipLocal(current.track.id, { ...current.clip, position: move.from })
    }
  }
  if (failure) toast.error(failure)
  if (landed.length) history.push(combineEntries(landed))
}

/** Drag drop for a multi-clip selection: everything moves by the same delta. */
function moveSelection(delta: number): void {
  const items = selectedClips.value
  if (!delta || !items.length || selectionBlocked(items)) return
  const bounds = deltaBoundsFor(items.map(({ clip }) => ({ clipId: clip.id, from: clip.position })))
  const d = clamp(delta, bounds.min, bounds.max)
  if (!d) return
  const moves = items.map(({ track, clip }) => ({ trackId: track.id, clipId: clip.id, from: clip.position, to: clip.position + d }))
  // Synchronously, before the first await: the dragged clip's followers stop
  // following as soon as this returns, and must already stand where they landed.
  applyPositions(moves)
  commitPositions(moves)
}

async function deleteSelection(): Promise<void> {
  const items = selectedClips.value
  if (!items.length) return
  if (items.length === 1) return deleteClip(items[0]!.track, items[0]!.clip)
  if (selectionBlocked(items)) return

  const snapshots = items.map(({ track, clip }) => ({ trackId: track.id, clip: { ...clip } }))
  const removed   = await Promise.all(snapshots.map(s => removeClipRemote(s.trackId, s.clip.id)))
  const entries   = snapshots.filter((_, i) => removed[i]).map(s => clipDeleteEntry(s.trackId, s.clip))
  if (!entries.length) return

  const entry = combineEntries(entries)
  history.push(entry)
  toast.show(t('editor.clipsDeleted', { count: entries.length }), {
    duration: 6000,
    action: { label: t('editor.undo'), run: () => { history.undoIfLatest(entry) } },
  })
}

// ── Nudging (, and .) ─────────────────────────────────────────────────────────
// Holding the key repeats it. Each step moves the selection locally at once;
// the write goes out when the keys go quiet, as ONE undo step, instead of a
// round of PATCHes and a history entry per auto-repeat.
const NUDGE_SETTLE_MS = 300
let _nudge: { key: string; moves: PositionMove[]; delta: number; timer: ReturnType<typeof setTimeout> | null } | null = null

function nudgeSelection(frames: number): void {
  const items = selectedClips.value
  if (!timeline.value || !items.length || selectionBlocked(items)) return

  const key = items.map(({ clip }) => clip.id).sort().join(',')
  if (_nudge && _nudge.key !== key) flushNudge()
  if (!_nudge) {
    _nudge = {
      key, delta: 0, timer: null,
      moves: items.map(({ track, clip }) => ({ trackId: track.id, clipId: clip.id, from: clip.position, to: clip.position })),
    }
  }

  const bounds = deltaBoundsFor(_nudge.moves)
  _nudge.delta = clamp(_nudge.delta + frames, bounds.min, bounds.max)
  for (const move of _nudge.moves) move.to = move.from + _nudge.delta
  applyPositions(_nudge.moves)

  if (_nudge.timer) clearTimeout(_nudge.timer)
  _nudge.timer = setTimeout(flushNudge, NUDGE_SETTLE_MS)
}

async function flushNudge(): Promise<void> {
  const n = _nudge
  _nudge = null
  if (!n) return
  if (n.timer) clearTimeout(n.timer)
  await commitPositions(n.moves.filter(m => m.to !== m.from))
}

/** Drops a pending nudge without writing it — the timeline it belonged to is gone. */
function cancelNudge(): void {
  if (_nudge?.timer) clearTimeout(_nudge.timer)
  _nudge = null
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
const shortcutsOpen = ref(false)
const addTrackOpen  = ref(false)

function onKeydown(e: KeyboardEvent): void {
  // A dialog or menu owns the keyboard while it is open. Without this, digits
  // pressed at a dialog's buttons cut source clips on the track behind it,
  // Space toggled playback and the arrows scrubbed while walking a menu.
  const target = e.target as HTMLElement | null
  if (anyDialogOpen.value) return
  if (target?.closest?.('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return

  // Alt +/−/0 zoom the timeline — claimed even while an input has focus, so the
  // shortcut behaves the same everywhere in the editor. Ctrl/⌘ +/−/0 are left
  // alone: they scale the page here exactly as they do on any other site.
  //
  // Keyed off e.code because Option rewrites the printed character on macOS
  // (Option+= is '≠'), which is what e.key would report.
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    if (e.code === 'Equal'  || e.code === 'NumpadAdd')      { e.preventDefault(); zoomIn();    return }
    if (e.code === 'Minus'  || e.code === 'NumpadSubtract') { e.preventDefault(); zoomOut();   return }
    if (e.code === 'Digit0' || e.code === 'Numpad0')        { e.preventDefault(); zoomReset(); return }
  }
  const tag = target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return

  // Undo/redo — only outside text fields (above), so an input keeps its own.
  const mod = (e.ctrlKey || e.metaKey) && !e.altKey
  if (mod && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? redo() : undo(); return }
  if (mod && e.code === 'KeyY' && !e.shiftKey) { e.preventDefault(); redo(); return }

  if (e.key === '?') { e.preventDefault(); shortcutsOpen.value = true; return }

  if (mod && e.code === 'KeyA') { e.preventDefault(); selectAllClips(); return }

  // Selected clips: Delete/Backspace removes them, , and . nudge them by a
  // frame (Shift: ten), Enter edits a lone one.
  const sel = selectedClips.value
  if (sel.length && !readonly.value && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); deleteSelection(); return }
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && sel.length === 1) {
      e.preventDefault()
      openEditClip(sel[0]!.track, sel[0]!.clip)
      return
    }
    if (e.code === 'Comma' || e.code === 'Period') {
      e.preventDefault()
      nudgeSelection((e.code === 'Comma' ? -1 : 1) * (e.shiftKey ? 10 : 1))
      return
    }
  }

  // L flips the transport between live and local.
  if (e.code === 'KeyL' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    e.preventDefault()
    setLiveMode(!transportLive.value)
    return
  }

  // Source switcher: 1…9 then 0 add a clip for the Nth source of the selected
  // track (number row or numpad). Bare digits only — Ctrl/⌘+digit belongs to
  // the browser, and a modifier held by accident shouldn't cut a take.
  if (!readonly.value && selectedTrackHasSourceSet.value && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    const source = selectedTrackSources.value[sourceIndexFromKey(e)]
    if (source) { e.preventDefault(); addSourceClip(source); return }
  }

  // Bare +/− step the zoom ladder too — no modifier needed outside inputs.
  // Ctrl/⌘ is excluded so the browser's own page zoom still gets the key.
  if (!e.ctrlKey && !e.metaKey) {
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); return }
    if (e.key === '-')                  { e.preventDefault(); zoomOut(); return }
  }
  // Ignore auto-repeat: holding space would otherwise machine-gun play/stop,
  // tearing down and restarting the run many times a second.
  if (e.code === 'Space')  { e.preventDefault(); if (!e.repeat) togglePlayback() }
  if (e.code === 'Home')   { e.preventDefault(); seekStart() }
  if (e.code === 'End')    { e.preventDefault(); seekEnd() }
  // Escape lets go one level at a time: the clip first, then the track.
  if (e.code === 'Escape') {
    if (selectedClipIds.value.length) selectedClipIds.value = []
    else selectedTrackId.value = null
  }
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    e.preventDefault()
    const back = e.code === 'ArrowLeft'
    // ⌘←/⌘→ jump to the ends. Mac laptop keyboards have no Home or End key —
    // reaching them needs Fn+Arrow — so without this the seek-to-edge shortcut
    // simply does not exist on a MacBook. Cmd+Arrow is the platform's own idiom
    // for "go to the beginning/end of the line", which is exactly this gesture.
    // Bound to metaKey only, so Ctrl+Arrow stays free for the window manager.
    if (e.metaKey) { back ? seekStart() : seekEnd(); return }
    const step = (e.shiftKey ? 10 : 1) * (back ? -1 : 1)
    setPlayhead(Math.round(playheadFrame.value) + step)
  }
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  if (_flashTimer) clearTimeout(_flashTimer)
  flushNudge()
  // The pending view save is flushed by useEditorViewMemory's own teardown.
  stopPlayback(false)
  destroyAudioEngine()
  clearWaveformCache()
  resetDownloads()   // paired with the caches above: they hold these downloads' decoded results
  sync.leave()
})

// ── Ruler scrubbing ───────────────────────────────────────────────────────────
function frameFromPointer(e: PointerEvent): number {
  const el = canvasRef.value
  if (!el || !timeline.value) return 0
  const rect = el.getBoundingClientRect()
  const x    = e.clientX - rect.left + el.scrollLeft
  return timeline.value.startFrame + x / pxPerFrame.value
}

function onScrubStart(e: PointerEvent): void {
  if (!canvasRef.value || !timeline.value) return
  setPlayhead(frameFromPointer(e))
  window.addEventListener('pointermove', onScrubMove)
  window.addEventListener('pointerup', onScrubEnd)
  window.addEventListener('pointercancel', onScrubEnd)
}
function onScrubMove(e: PointerEvent) { setPlayhead(frameFromPointer(e)) }
function onScrubEnd(): void {
  window.removeEventListener('pointermove', onScrubMove)
  window.removeEventListener('pointerup', onScrubEnd)
  window.removeEventListener('pointercancel', onScrubEnd)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Returns the sources belonging to a track's sourceSet (via its trackType).
function getTrackSources(track: EditorTrack): Source[] {
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
function blockedByLock(track: EditorTrack | null | undefined): boolean {
  if (!track?.isLocked) return false
  toast.warning(t('editor.trackLocked', { name: track.name }))
  return true
}

/** A view-only viewer (silently — nothing was offered) or a locked track. */
function cannotEdit(track: EditorTrack | null | undefined): boolean {
  return readonly.value || blockedByLock(track)
}

// ── Track mutations ───────────────────────────────────────────────────────────

// A freshly created track comes back as the bare row, while the timeline
// payload joins its type's display fields onto every track. Decorating here
// keeps the list one shape, so a new track shows its colour and icon straight
// away instead of only after a reload.
function withTypeFields(track: EditorTrack): EditorTrack {
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

function onTrackAdded(track: EditorTrack): void {
  upsertTrackLocal(withTypeFields(track))
}

async function patchTrack(track: EditorTrack, json: Record<string, unknown>): Promise<void> {
  const { ok, data } = await $fetch<EditorTrack>(trackUrl(track.id), { method: 'PATCH', json })
  if (!ok) return
  upsertTrackLocal({ ...data, id: track.id })
}

const toggleLock = (track: EditorTrack) => { if (!readonly.value) patchTrack(track, { isLocked: !track.isLocked }) }

// Per-track settings (name + icon override). The PATCH response carries only
// the track row, so it merges onto the joined type/source fields already held.
const trackDialog = ref<{ open: boolean; track: EditorTrack | null }>({ open: false, track: null })

function openTrackSettings(track: EditorTrack): void {
  if (cannotEdit(track)) return
  trackDialog.value = { open: true, track }
}

function onTrackSaved(track: EditorTrack): void {
  upsertTrackLocal(track)
}

// Deleting a track takes every clip with it — always confirm first.
const deleteTrackTarget = ref<EditorTrack | null>(null)
const deletingTrack     = ref(false)

async function confirmDeleteTrack() {
  const track = deleteTrackTarget.value
  if (!track) return
  if (cannotEdit(track)) { deleteTrackTarget.value = null; return }
  deletingTrack.value = true
  const { ok } = await $fetch(trackUrl(track.id), { method: 'DELETE' })
  deletingTrack.value     = false
  deleteTrackTarget.value = null
  if (!ok) return
  removeTrackLocal(track.id)
  if (selectedTrackId.value === track.id) selectedTrackId.value = null
}

// ── Clip mutations ────────────────────────────────────────────────────────────
const clipDialog = ref<{
  open: boolean
  track: EditorTrack | null
  clip: EditorClip | null
  defaultPosition: number
  trackSources: Source[]
}>({ open: false, track: null, clip: null, defaultPosition: 0, trackSources: [] })

const bpmDialog = ref<{
  open: boolean
  track: EditorTrack | null
  clip: EditorClip | null
  defaultPosition: number
}>({ open: false, track: null, clip: null, defaultPosition: 0 })

const anyDialogOpen = computed(() =>
  addTrackOpen.value || trackDialog.value.open || clipDialog.value.open || bpmDialog.value.open ||
  deleteTrackTarget.value !== null || shortcutsOpen.value,
)

/** Opens the add dialog at `frame` (a double-clicked spot) or the playhead. */
function openAddClip(track: EditorTrack, frame?: number): void {
  if (cannotEdit(track)) return
  const tl = timeline.value
  const at = Math.round(frame ?? playheadFrame.value)
  const defaultPosition = tl ? clamp(at, tl.startFrame, tl.endFrame - 1) : at
  if (settingsFor(track).metronome) {
    bpmDialog.value = { open: true, track, clip: null, defaultPosition }
    return
  }
  clipDialog.value = {
    open:            true,
    track,
    clip:            null,
    defaultPosition,
    trackSources:    getTrackSources(track),
  }
}
function openEditClip(track: EditorTrack, clip: EditorClip): void {
  if (cannotEdit(track)) return
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

/** Records a dialog save — a create, or an edit against the clip as it was. */
function recordDialogSave(track: EditorTrack, before: EditorClip | null, saved: EditorClip): void {
  const merged = upsertClipLocal(track.id, saved)
  if (!merged) return
  history.push(before
    ? clipPatchEntry(track.id, before.id, pickClipFields(before), pickClipFields(merged))
    : clipCreateEntry(track.id, merged))
}

function onBpmClipSaved(clip: EditorClip): void {
  const { track, clip: before } = bpmDialog.value
  if (track) recordDialogSave(track, before, clip)
}
function closeClipDialog(): void {
  clipDialog.value = { ...clipDialog.value, open: false }
}

function onClipSaved(savedClip: EditorClip): void {
  const { track, clip: before } = clipDialog.value
  if (!track) return
  recordDialogSave(track, before, savedClip)
  closeClipDialog()
}

// The single choke point for drag edits (move, trim). Failures toast (useApi)
// and tell the clip, so it drops the position it was holding for the write.
async function patchClip(track: EditorTrack, clip: EditorClip, json: ClipFields): Promise<boolean> {
  if (cannotEdit(track)) { rejectEdit(clip.id); return false }
  const before = pickClipFields(clip, Object.keys(json))
  const { ok, data } = await $fetch<EditorClip>(clipUrl(clip.id), { method: 'PATCH', json })
  if (!ok) { rejectEdit(clip.id); return false }
  const merged = upsertClipLocal(track.id, { ...data, id: clip.id })
  if (merged) history.push(clipPatchEntry(track.id, clip.id, before, pickClipFields(merged, Object.keys(json))))
  return true
}

/** A dragged clip that is part of a multi-clip selection takes the rest with it. */
function moveClip(track: EditorTrack, clip: EditorClip, position: number): void {
  if (groupMembersFor(clip.id)) { moveSelection(position - clip.position); return }
  patchClip(track, clip, { position })
}
const cropClip = (track: EditorTrack, clip: EditorClip, fields: ClipFields) => patchClip(track, clip, fields)

async function deleteClip(track: EditorTrack, clip: EditorClip): Promise<void> {
  // "Delete" on any clip of a multi-clip selection deletes the selection.
  if (groupMembersFor(clip.id)) return deleteSelection()
  if (cannotEdit(track)) return
  const snapshot = { ...clip }
  if (!await removeClipRemote(track.id, clip.id)) return
  const entry = clipDeleteEntry(track.id, snapshot)
  history.push(entry)
  toast.show(t('editor.clipDeleted', { name: snapshot.label || track.name }), {
    duration: 6000,
    action: { label: t('editor.undo'), run: () => { history.undoIfLatest(entry) } },
  })
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
provide('editor-canvas',     canvasRef)
provide('editor-readonly',   readonly)
provide('editor-rejected',   rejectedEdit)
provide('editor-snap',       { guide: snapGuide, targets: snapTargets })
provide('editor-group',      { drag: groupDrag, membersFor: groupMembersFor, deltaBounds: groupDeltaBounds })
</script>

<template>
  <div class="relative flex flex-col h-dvh bg-background overflow-hidden">

    <!-- Loading is covered by TimelineLoadingScreen, raised in App.vue from the
         moment the route is entered — it outlives this component's chunk. -->
    <div v-if="error" class="flex-1 flex flex-col items-center justify-center gap-4 px-4 text-center">
      <Icon icon="mdi:timeline-alert-outline" class="size-10 text-muted-foreground/60" />
      <p class="text-sm text-destructive">{{ error }}</p>
      <div class="flex items-center gap-2">
        <Button variant="ghost" size="sm" @click="goBack">
          <Icon icon="mdi:chevron-left" class="size-4" />
          {{ $t('editor.back') }}
        </Button>
        <Button size="sm" :disabled="loading" @click="load">
          <Icon icon="mdi:refresh" class="size-4" />
          {{ $t('editor.retry') }}
        </Button>
      </div>
    </div>

    <!-- Editor -->
    <template v-else-if="timeline">

      <EditorToolbar
        :timeline="timeline"
        :zoom-label="zoomLabel"
        :playhead-frame="playheadFrame"
        :is-playing="isPlaying"
        :audio-blocked="audioBlocked"
        :peers="sync.peers.value"
        :sync-connected="sync.connected.value"
        :reconnecting="sync.reconnecting.value"
        :can-undo="canUndo"
        :can-redo="canRedo"
        :readonly="readonly"
        :transport-live="transportLive"
        :room-playing="roomPlaying"
        @update:transport-live="setLiveMode"
        @go-back="goBack"
        @zoom-in="zoomIn"
        @zoom-out="zoomOut"
        @zoom-fit="zoomFit"
        @zoom-reset="zoomReset"
        @add-track="addTrackOpen = true"
        @toggle-play="togglePlayback"
        @seek-start="seekStart"
        @seek-end="seekEnd"
        @undo="undo"
        @redo="redo"
        @shortcuts="shortcutsOpen = true"
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

          <div ref="trackHeadersRef" class="flex-1 overflow-y-hidden relative" @wheel="onHeadersWheel">
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
              :resizable="!isStripTrack(track)"
              :muted="isTrackMuted(track)"
              :supports-audio="supportsAudio(track)"
              :volume="trackVolume(track)"
              :readonly="readonly"
              :class="reorderDrag?.trackId === track.id ? 'opacity-60' : ''"
              @update:volume="setTrackVolume(track, $event)"
              @select="selectTrack(track, { toggle: true })"
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

            <!-- Directly under the bottom track. Scrolls with the headers, so the
                 canvas reserves the same ADD_TRACK_ROW_PX below its lanes. -->
            <button
              v-if="!readonly"
              class="border-b border-border px-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center gap-2 w-full"
              :style="{ height: ADD_TRACK_ROW_PX + 'px' }"
              @click="addTrackOpen = true"
            >
              <Icon icon="mdi:plus" class="size-4 shrink-0" />
              {{ $t('editor.addTrack') }}
            </button>
          </div>

          <!-- API accounts in the room, pinned to the bottom of the tracks column.
               Measured: the canvas reserves the same height below its lanes. -->
          <div ref="deviceFooterRef" class="shrink-0">
            <DeviceRow :peers="sync.peers.value" class="border-t border-border px-2 py-1.5" />
          </div>
        </div>

        <!-- Sidebar width resize handle -->
        <ResizeHandle
          axis="x"
          class="self-stretch -ml-0.5"
          :active="sidebarResizer.resizing.value"
          @pointerdown="startSidebarResize"
        />

        <!-- Right panel: canvas -->
        <div ref="canvasRef" class="tl-scroll flex-1 overflow-auto relative" @scroll="onCanvasScroll">
          <div :style="{ width: timelineWidth + 'px', minWidth: '100%', position: 'relative' }">

            <Ruler
              :timeline="timeline"
              :px-per-frame="pxPerFrame"
              :playhead-frame="playheadFrame"
              @scrub="onScrubStart"
            />

            <!-- The extra space matches the add-track button and the API-account
                 footer in the headers column, so both columns scroll the same
                 distance and the bottom rows stay aligned. -->
            <div class="relative" :style="{ minHeight: totalTracksHeight + (readonly ? 0 : ADD_TRACK_ROW_PX) + deviceFooterHeight + 'px' }">
              <!-- Playhead line -->
              <div
                class="absolute top-0 bottom-0 w-px bg-primary/70 pointer-events-none z-10"
                :style="{ left: playheadX + 'px' }"
              />

              <!-- Snap guide: where the dragged edge caught -->
              <div
                v-if="snapGuideX != null"
                class="absolute top-0 bottom-0 w-px bg-amber-400 pointer-events-none z-40"
                :style="{ left: snapGuideX + 'px' }"
              />

              <template v-for="track in orderedTracks" :key="track.id">
                <BpmLane
                  :class="isTrackHidden(track) ? 'invisible' : ''"
                  v-if="settingsFor(track).trackDisplay === 'bpm'"
                  :track="track"
                  :timeline="timeline"
                  :px-per-frame="pxPerFrame"
                  :height="trackHeight(track)"
                  :selected="track.id === selectedTrackId"
                  :muted="isTrackMuted(track)"
                  :selected-clip-ids="selectedClipIds"
                  @select="onLaneClick(track)"
                  @select-clip="(clip: EditorClip, mods?: ClipSelectMods) => selectClip(clip, mods)"
                  @add-at="openAddClip(track, $event)"
                  @edit-clip="openEditClip(track, $event)"
                  @delete-clip="deleteClip(track, $event)"
                  @move-clip="moveClip(track, $event.clip, $event.position)"
                />
                <RulerLane
                  :class="isTrackHidden(track) ? 'invisible' : ''"
                  v-else-if="settingsFor(track).trackDisplay === 'ruler'"
                  :track="track"
                  :timeline="timeline"
                  :px-per-frame="pxPerFrame"
                  :height="trackHeight(track)"
                  :selected="track.id === selectedTrackId"
                  :muted="isTrackMuted(track)"
                  :selected-clip-ids="selectedClipIds"
                  @select="onLaneClick(track)"
                  @select-clip="(clip: EditorClip, mods?: ClipSelectMods) => selectClip(clip, mods)"
                  @add-at="openAddClip(track, $event)"
                  @edit-clip="openEditClip(track, $event)"
                  @delete-clip="deleteClip(track, $event)"
                  @move-clip="moveClip(track, $event.clip, $event.position)"
                />
                <TrackLane
                  :class="isTrackHidden(track) ? 'invisible' : ''"
                  v-else
                  :track="track"
                  :timeline="timeline"
                  :px-per-frame="pxPerFrame"
                  :height="trackHeight(track)"
                  :selected="track.id === selectedTrackId"
                  :muted="isTrackMuted(track)"
                  :name-display="settingsFor(track).nameDisplay"
                  :clip-display="settingsFor(track).clipDisplay"
                  :selected-clip-ids="selectedClipIds"
                  :empty-hint="readonly || track.isLocked ? '' : $t('editor.laneEmptyHint')"
                  @select="onLaneClick(track)"
                  @select-clip="(clip: EditorClip, mods?: ClipSelectMods) => selectClip(clip, mods)"
                  @add-at="openAddClip(track, $event)"
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
        v-if="selectedTrack && selectedTrackHasSourceSet && !readonly"
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
      :timeline-id="String(route.params.tlId)"
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
      :playhead-frame="playheadFrame"
      @update:open="!$event && closeClipDialog()"
      @saved="onClipSaved"
    />

    <BpmClipDialog
      :open="bpmDialog.open"
      :track="bpmDialog.track"
      :clip="bpmDialog.clip"
      :default-position="bpmDialog.defaultPosition"
      :frame-rate="timeline?.frameRate ?? 25"
      :playhead-frame="playheadFrame"
      @update:open="bpmDialog = { ...bpmDialog, open: $event }"
      @saved="onBpmClipSaved"
    />

    <ShortcutsDialog v-model:open="shortcutsOpen" />

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

<style>
/*
 * The timeline canvas scrollbar.
 *
 * Bigger and always visible, which matters more here than on an ordinary page.
 * The horizontal bar is not just a control: on an hour-long timeline it is the
 * only persistent indication of WHERE you are and how much of the whole you can
 * see. macOS hides overlay scrollbars until you scroll, so on a Mac that
 * indicator vanished exactly when you stopped moving and wanted to read it.
 *
 * Declaring ::-webkit-scrollbar opts this element out of overlay scrollbars, so
 * the bar becomes a real, permanently visible, layout-occupying track in every
 * browser that supports it.
 *
 * Colours come from the theme tokens, so it follows light/dark like everything
 * else. Tokens are OKLCH TRIPLETS ("0.88 0.015 241"), hence oklch(var(--x)) —
 * wrapping them in hsl() would produce a near-white nonsense colour.
 */
.tl-scroll {
  /* Firefox: no px control, but it takes the colours and the wider preset. */
  scrollbar-width: auto;
  scrollbar-color: oklch(var(--border)) transparent;
}

.tl-scroll::-webkit-scrollbar {
  width: 14px;
  height: 14px;
}

.tl-scroll::-webkit-scrollbar-track {
  background: transparent;
}

/*
 * The thumb is inset from its track by a transparent border rather than being
 * drawn 14px thick: a full-width slab looks heavy against the canvas, while a
 * generous track still gives a large, easy pointer target. background-clip
 * keeps the fill inside the padding box so the border reads as breathing room.
 */
.tl-scroll::-webkit-scrollbar-thumb {
  background-color: oklch(var(--border));
  background-clip: padding-box;
  border: 3px solid transparent;
  border-radius: 9999px;
}

/*
 * A minimum grab size, applied PER AXIS.
 *
 * It has to be per axis: a bare `min-height` would also apply to the horizontal
 * thumb, where the track is only 14px tall, and force it to overflow its own
 * scrollbar. Each axis constrains only its own long edge.
 *
 * The floor matters most on a long timeline — at an hour's length the thumb
 * would otherwise shrink to a few pixels and become almost impossible to hit.
 */
.tl-scroll::-webkit-scrollbar-thumb:horizontal {
  min-width: 48px;
}

.tl-scroll::-webkit-scrollbar-thumb:vertical {
  min-height: 48px;
}

.tl-scroll::-webkit-scrollbar-thumb:hover {
  background-color: oklch(var(--muted-foreground) / 0.65);
}

.tl-scroll::-webkit-scrollbar-thumb:active {
  background-color: oklch(var(--muted-foreground));
}

/* Where the two bars meet, so the square doesn't render as a grey block. */
.tl-scroll::-webkit-scrollbar-corner {
  background: transparent;
}
</style>
