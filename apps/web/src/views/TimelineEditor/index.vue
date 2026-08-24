<script setup lang="ts">
import { ref, computed, provide, nextTick, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { ResizeHandle, ConfirmDialog, useToast } from '@starling/ui'
import { useApi } from '../../composables/useApi'
import { usePageTitle } from '../../composables/usePageTitle'
import { useLocalStorage } from '../../composables/useLocalStorage'
import { clamp, framesToTC, sourceIndexFromKey } from './lib/editorUtils'
import { useEditorViewport } from './view/useEditorViewport'
import { useEditorZoom } from './view/useEditorZoom'
import { useEditorLayout } from './view/useEditorLayout'
import { useEditorViewMemory } from './view/useEditorViewMemory'
import { createDrag } from './lib/pointerDrag'
import { useTimelineSync } from './data/useTimelineSync'
import { usePlayback } from './audio/usePlayback'
import { destroyAudioEngine, setTrackVolume as applyTrackVolume } from './audio/useAudioEngine'
import { clearWaveformCache } from './audio/useWaveform'
import { describeDownload, resetDownloads } from './media/mediaDownloads'
import { resolveTrackSettings, trackSupportsAudio } from './behaviors/trackSettings'
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

const timelineUrl = computed(() => `/api/timeline/${route.params.tlId}`)
const trackUrl = (trackId: string) => `${timelineUrl.value}/tracks/${trackId}`
const clipUrl  = (clipId: string)  => `${timelineUrl.value}/clips/${clipId}`

async function load() {
  loading.value = true
  error.value   = ''
  const { ok, data } = await $fetch<TimelineBootstrap>(timelineUrl.value, { silent: true })
  loading.value = false
  if (!ok) { error.value = t('editor.couldNotLoad'); finishOpening(); return }
  timeline.value   = data.timeline
  // Names the loading screen for anyone who arrived by pasted URL.
  describeOpening(data.timeline)
  trackList.value  = data.tracks
  trackTypes.value = data.trackTypes
  sources.value    = data.sources
  describeClipMedia()
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

function upsertClipLocal(trackId: string, clip: EditorClip): EditorClip | null {
  const track = trackList.value.find(x => x.id === trackId)
  if (!track) return null
  const i      = track.clips.findIndex(c => c.id === clip.id)
  const merged = i !== -1 ? { ...track.clips[i], ...clip } : clip
  if (i !== -1) track.clips[i] = merged
  else          track.clips.push(merged)
  track.clips.sort((a, b) => a.position - b.position)
  return merged
}

function removeClipLocal(trackId: string, clipId: string): void {
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
const playback = usePlayback({
  timeline, trackList, trackTypes, mutedTracks, trackVolumes, pxPerFrame, canvasRef,
  sendTransport: (...args) => sync.sendTransport(...args),
})
const {
  playheadFrame, playheadX, isPlaying, audioBlocked,
  setPlayhead, seekStart, seekEnd, stopPlayback, togglePlayback,
} = playback

// ── Layout ────────────────────────────────────────────────────────────────────
const {
  sidebarWidth, trackHeight, totalTracksHeight,
  sidebarResizer, startSidebarResize, startRowResize,
} = useEditorLayout({ tracks: trackList, settingsFor, onSidebarResize: updateViewport })

// ── Track selection + source bar ──────────────────────────────────────────────
const selectedTrackId = ref<string | null>(null)
const selectedTrack   = computed(() =>
  trackList.value.find(tr => tr.id === selectedTrackId.value) ?? null,
)

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

function selectTrack(track: EditorTrack): void {
  if (_suppressSelect) return
  selectedTrackId.value = selectedTrackId.value === track.id ? null : track.id
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
  if (trackList.value.length < 2) return
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
  applyTrackOrder(order)   // optimistic; reload if the server disagrees
  const { ok, data } = await $fetch<{ order: string[] }>(`${timelineUrl.value}/tracks/reorder`, {
    method: 'POST', json: { order }, silent: true,
  })
  if (!ok) { load(); return }
  applyTrackOrder(data.order)
  sync.sendTrackChange({ type: 'reorder', order: data.order })
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
  if (!track || blockedByLock(track)) return
  flashSource(source.id)
  const { ok, data } = await $fetch<EditorClip>(`${timelineUrl.value}/clips`, {
    method: 'POST',
    json:   { trackId: track.id, position: Math.max(0, Math.round(playheadFrame.value)), sourceId: source.id },
    silent: true,
  })
  if (!ok) return
  upsertClipLocal(track.id, data)
  sync.sendClipChange({ type: 'upsert', trackId: track.id, clip: data })
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
function onKeydown(e: KeyboardEvent): void {
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
  const target = e.target as HTMLElement | null
  const tag = target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return

  // Source switcher: 1…9 then 0 add a clip for the Nth source of the selected
  // track (number row or numpad). Bare digits only — Ctrl/⌘+digit belongs to
  // the browser, and a modifier held by accident shouldn't cut a take.
  if (selectedTrackHasSourceSet.value && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
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
  if (_flashTimer) clearTimeout(_flashTimer)
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
}
function onScrubMove(e: PointerEvent) { setPlayhead(frameFromPointer(e)) }
function onScrubEnd(): void {
  window.removeEventListener('pointermove', onScrubMove)
  window.removeEventListener('pointerup', onScrubEnd)
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

// ── Track mutations ───────────────────────────────────────────────────────────
const addTrackOpen = ref(false)

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
  const added = upsertTrackLocal(withTypeFields(track))
  sync.sendTrackChange({ type: 'upsert', track: added })
}

async function patchTrack(track: EditorTrack, json: Record<string, unknown>): Promise<void> {
  const { ok, data } = await $fetch<EditorTrack>(trackUrl(track.id), { method: 'PATCH', json, silent: true })
  if (!ok) return
  const merged = upsertTrackLocal({ ...data, id: track.id })
  sync.sendTrackChange({ type: 'upsert', track: merged })
}

const toggleLock = (track: EditorTrack) => patchTrack(track, { isLocked: !track.isLocked })

// Per-track settings (name + icon override). The PATCH response carries only
// the track row, so it merges onto the joined type/source fields already held.
const trackDialog = ref<{ open: boolean; track: EditorTrack | null }>({ open: false, track: null })

function openTrackSettings(track: EditorTrack): void {
  if (blockedByLock(track)) return
  trackDialog.value = { open: true, track }
}

function onTrackSaved(track: EditorTrack): void {
  const merged = upsertTrackLocal(track)
  sync.sendTrackChange({ type: 'upsert', track: merged })
}

// Deleting a track takes every clip with it — always confirm first.
const deleteTrackTarget = ref<EditorTrack | null>(null)
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

function openAddClip(track: EditorTrack): void {
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
function openEditClip(track: EditorTrack, clip: EditorClip): void {
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

function onBpmClipSaved(clip: EditorClip): void {
  const trackId = bpmDialog.value.track?.id
  if (!trackId) return
  const merged = upsertClipLocal(trackId, clip)
  if (merged) sync.sendClipChange({ type: 'upsert', trackId, clip: merged })
}
function closeClipDialog(): void {
  clipDialog.value = { ...clipDialog.value, open: false }
}

function onClipSaved(savedClip: EditorClip): void {
  const trackId = clipDialog.value.track?.id
  if (!trackId) return
  const merged = upsertClipLocal(trackId, savedClip)
  if (merged) sync.sendClipChange({ type: 'upsert', trackId, clip: merged })
  closeClipDialog()
}

// The single choke point for clip edits (move, crop, dialog saves).
async function patchClip(track: EditorTrack, clip: EditorClip, json: Record<string, unknown>): Promise<void> {
  if (blockedByLock(track)) return
  const { ok, data } = await $fetch<EditorClip>(clipUrl(clip.id), {
    method: 'PATCH', json, silent: true,
  })
  if (!ok) return
  const merged = upsertClipLocal(track.id, { ...data, id: clip.id })
  if (merged) sync.sendClipChange({ type: 'upsert', trackId: track.id, clip: merged })
}

const moveClip = (track: EditorTrack, clip: EditorClip, position: number) => patchClip(track, clip, { position })
const cropClip = (track: EditorTrack, clip: EditorClip, fields: Record<string, unknown>) => patchClip(track, clip, fields)

async function deleteClip(track: EditorTrack, clip: EditorClip): Promise<void> {
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
        :audio-blocked="audioBlocked"
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
              :resizable="!isStripTrack(track)"
              :muted="isTrackMuted(track)"
              :supports-audio="supportsAudio(track)"
              :volume="trackVolume(track)"
              :class="reorderDrag?.trackId === track.id ? 'opacity-60' : ''"
              @update:volume="setTrackVolume(track, $event)"
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
                  :class="isTrackHidden(track) ? 'invisible' : ''"
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
                  :class="isTrackHidden(track) ? 'invisible' : ''"
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
