<script setup>
import { ref, computed, provide, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Skeleton } from '@starling/ui'
import { useApi } from '../../composables/useApi.js'
import { usePageTitle } from '../../composables/usePageTitle.js'
import { clamp } from './useEditorUtils.js'
import { useTimelineSync } from './useTimelineSync.js'
import {
  startAudioPlayback,
  stopAudioPlayback,
  destroyAudioEngine,
} from './useAudioEngine.js'
import EditorToolbar   from './components/EditorToolbar.vue'
import Ruler           from './components/Ruler.vue'
import TrackHeader     from './components/TrackHeader.vue'
import TrackLane       from './components/TrackLane.vue'
import AddTrackDialog  from './components/AddTrackDialog.vue'
import ClipDialog      from './components/ClipDialog.vue'

const route      = useRoute()
const router     = useRouter()
const { t }      = useI18n()
const { $fetch } = useApi()

// ── Data ─────────────────────────────────────────────────────────────────────
const timeline   = ref(null)
const trackList  = ref([])
const trackTypes = ref([])
const sources    = ref([])
const loading    = ref(true)
const error      = ref('')

async function load() {
  loading.value = true
  error.value   = ''
  const { cslug, pslug, tlId } = route.params
  const { ok, data } = await $fetch(
    `/api/company/${cslug}/production/${pslug}/timelines/${tlId}`,
    { silent: true },
  )
  loading.value = false
  if (!ok) { error.value = t('editor.couldNotLoad'); return }
  timeline.value   = data.timeline
  trackList.value  = data.tracks
  trackTypes.value = data.trackTypes
  sources.value    = data.sources
  sync.join(route.params.tlId)
}

onMounted(load)

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
  },
  onPlayhead(state) {
    applyRemotePlayhead(state)
  },
})

// ── Zoom ──────────────────────────────────────────────────────────────────────
const ZOOM_STEPS    = [0.25, 0.5, 1, 2, 4, 8, 16, 32]
const pxPerFrame    = ref(2)
const timelineWidth = computed(() =>
  timeline.value ? (timeline.value.endFrame - timeline.value.startFrame) * pxPerFrame.value : 0,
)

function zoomBy(dir, anchorClientX = null) {
  const i  = ZOOM_STEPS.indexOf(pxPerFrame.value)
  const ni = clamp(i + dir, 0, ZOOM_STEPS.length - 1)
  if (ni === i || !timeline.value) return

  const canvas = canvasRef.value
  // Keep the frame under the anchor (cursor or viewport center) stationary.
  const anchorX = canvas
    ? (anchorClientX != null ? anchorClientX - canvas.getBoundingClientRect().left : canvas.clientWidth / 2)
    : 0
  const anchorFrame = canvas
    ? timeline.value.startFrame + (canvas.scrollLeft + anchorX) / pxPerFrame.value
    : 0

  pxPerFrame.value = ZOOM_STEPS[ni]

  if (canvas) {
    nextTick(() => {
      canvas.scrollLeft = (anchorFrame - timeline.value.startFrame) * pxPerFrame.value - anchorX
    })
  }
}

const zoomIn  = () => zoomBy(1)
const zoomOut = () => zoomBy(-1)

function onCanvasWheel(e) {
  if (!e.ctrlKey && !e.metaKey) return
  e.preventDefault()
  zoomBy(e.deltaY < 0 ? 1 : -1, e.clientX)
}

// ── Playhead ──────────────────────────────────────────────────────────────────
// Stored as float for smooth animation; TC display rounds it.
const playheadFrame = ref(0)
watch(timeline, tl => { if (tl) playheadFrame.value = tl.startFrame }, { immediate: true })

const playheadX = computed(() =>
  timeline.value ? (playheadFrame.value - timeline.value.startFrame) * pxPerFrame.value : 0,
)

function setPlayhead(frame, { broadcast = true } = {}) {
  if (!timeline.value) return
  playheadFrame.value = clamp(frame, timeline.value.startFrame, timeline.value.endFrame)
  if (broadcast) sync.sendPlayhead(playheadFrame.value, isPlaying.value)
}

function seekStart() {
  stopPlayback(false)
  setPlayhead(timeline.value?.startFrame ?? 0)
}

function seekEnd() {
  stopPlayback(false)
  setPlayhead(timeline.value?.endFrame ?? 0)
}

// ── Playback ──────────────────────────────────────────────────────────────────
const isPlaying = ref(false)
let _rafId      = null
let _lastTs     = null
let _lastSyncMs = 0

const PLAYING_SYNC_INTERVAL_MS = 1000

function startPlayback(broadcast = true) {
  if (!timeline.value) return
  if (playheadFrame.value >= timeline.value.endFrame) {
    playheadFrame.value = timeline.value.startFrame
  }
  isPlaying.value = true
  _lastTs         = null
  _lastSyncMs     = Date.now()
  _rafId          = requestAnimationFrame(_tick)

  const fps      = parseFloat(timeline.value.frameRate)
  const allClips = trackList.value.flatMap(t => t.clips)
  startAudioPlayback(allClips, playheadFrame.value, fps)

  if (broadcast) sync.sendPlayhead(playheadFrame.value, true, { immediate: true })
}

function stopPlayback(broadcast = true) {
  const wasPlaying = isPlaying.value
  isPlaying.value = false
  if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null }
  _lastTs = null
  stopAudioPlayback()

  if (broadcast && wasPlaying) sync.sendPlayhead(playheadFrame.value, false, { immediate: true })
}

function togglePlayback() {
  isPlaying.value ? stopPlayback() : startPlayback()
}

function _tick(ts) {
  if (!_lastTs) _lastTs = ts
  const elapsed = ts - _lastTs
  _lastTs = ts

  const fps = parseFloat(timeline.value.frameRate)
  playheadFrame.value += elapsed * fps / 1000

  if (playheadFrame.value >= timeline.value.endFrame) {
    playheadFrame.value = timeline.value.endFrame
    stopPlayback()
    return
  }

  // Keep the playhead in view while playing.
  const canvas = canvasRef.value
  if (canvas) {
    const x     = (playheadFrame.value - timeline.value.startFrame) * pxPerFrame.value
    const viewL = canvas.scrollLeft
    const viewR = viewL + canvas.clientWidth
    if (x > viewR - 40 || x < viewL) {
      canvas.scrollLeft = Math.max(0, x - canvas.clientWidth * 0.2)
    }
  }

  // Periodic re-sync so followers correct drift.
  const now = Date.now()
  if (now - _lastSyncMs >= PLAYING_SYNC_INTERVAL_MS) {
    _lastSyncMs = now
    sync.sendPlayhead(playheadFrame.value, true)
  }

  _rafId = requestAnimationFrame(_tick)
}

// ── Remote playhead ───────────────────────────────────────────────────────────
function applyRemotePlayhead({ frame, isPlaying: remotePlaying }) {
  if (!timeline.value) return
  const fps = parseFloat(timeline.value.frameRate)

  if (remotePlaying) {
    if (!isPlaying.value) {
      setPlayhead(frame, { broadcast: false })
      startPlayback(false)
    } else if (Math.abs(playheadFrame.value - frame) > fps / 2) {
      // Drifted more than half a second — snap and restart audio at the new position.
      stopPlayback(false)
      setPlayhead(frame, { broadcast: false })
      startPlayback(false)
    }
  } else {
    if (isPlaying.value) stopPlayback(false)
    setPlayhead(frame, { broadcast: false })
  }
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
function onKeydown(e) {
  const tag = e.target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return
  if (e.code === 'Space') { e.preventDefault(); togglePlayback() }
  if (e.code === 'Home')  { e.preventDefault(); seekStart() }
  if (e.code === 'End')   { e.preventDefault(); seekEnd() }
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    e.preventDefault()
    const step = (e.shiftKey ? 10 : 1) * (e.code === 'ArrowLeft' ? -1 : 1)
    setPlayhead(Math.round(playheadFrame.value) + step)
  }
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  stopPlayback(false)
  destroyAudioEngine()
  sync.leave()
})

// ── Scroll sync ───────────────────────────────────────────────────────────────
const canvasRef       = ref(null)
const trackHeadersRef = ref(null)

function onCanvasScroll() {
  if (trackHeadersRef.value && canvasRef.value) {
    trackHeadersRef.value.scrollTop = canvasRef.value.scrollTop
  }
}

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

// ── Track mutations ───────────────────────────────────────────────────────────
const addTrackOpen = ref(false)

function onTrackAdded(track) {
  const added = upsertTrackLocal(track)
  sync.sendTrackChange({ type: 'upsert', track: added })
}

async function patchTrack(track, json) {
  const { ok, data } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/timelines/${route.params.tlId}/tracks/${track.id}`,
    { method: 'PATCH', json, silent: true },
  )
  if (!ok) return
  const merged = upsertTrackLocal({ ...data, id: track.id })
  sync.sendTrackChange({ type: 'upsert', track: merged })
}

const toggleMute = (track) => patchTrack(track, { isMuted: !track.isMuted })
const toggleLock = (track) => patchTrack(track, { isLocked: !track.isLocked })

async function deleteTrack(track) {
  const { ok } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/timelines/${route.params.tlId}/tracks/${track.id}`,
    { method: 'DELETE', silent: true },
  )
  if (!ok) return
  removeTrackLocal(track.id)
  sync.sendTrackChange({ type: 'remove', trackId: track.id })
}

// ── Clip mutations ────────────────────────────────────────────────────────────
const clipDialog = ref({ open: false, track: null, clip: null, defaultPosition: 0, trackSources: [] })

function openAddClip(track) {
  clipDialog.value = {
    open:            true,
    track,
    clip:            null,
    defaultPosition: Math.round(playheadFrame.value),
    trackSources:    getTrackSources(track),
  }
}
function openEditClip(track, clip) {
  clipDialog.value = {
    open:            true,
    track,
    clip,
    defaultPosition: clip.position,
    trackSources:    getTrackSources(track),
  }
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

async function patchClip(track, clip, json) {
  const { ok, data } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/timelines/${route.params.tlId}/tracks/${track.id}/clips/${clip.id}`,
    { method: 'PATCH', json, silent: true },
  )
  if (!ok) return
  const merged = upsertClipLocal(track.id, { ...data, id: clip.id })
  if (merged) sync.sendClipChange({ type: 'upsert', trackId: track.id, clip: merged })
}

const moveClip = (track, clip, position) => patchClip(track, clip, { position })
const cropClip = (track, clip, fields)   => patchClip(track, clip, fields)

async function deleteClip(track, clip) {
  const { ok } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/timelines/${route.params.tlId}/tracks/${track.id}/clips/${clip.id}`,
    { method: 'DELETE', silent: true },
  )
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
</script>

<template>
  <div class="flex flex-col h-dvh bg-background overflow-hidden">

    <!-- Loading skeleton -->
    <template v-if="loading">
      <div class="h-12 border-b border-border flex items-center px-4 gap-3">
        <Skeleton class="h-5 w-20 rounded" />
        <Skeleton class="h-5 w-40 rounded" />
        <div class="flex-1" />
        <Skeleton class="h-7 w-24 rounded-md" />
      </div>
      <div class="flex-1 flex">
        <div class="w-56 border-r border-border flex flex-col gap-0">
          <Skeleton class="h-8 rounded-none" />
          <Skeleton v-for="i in 3" :key="i" class="h-10 rounded-none border-b border-border" />
        </div>
        <div class="flex-1 p-6 flex flex-col gap-2">
          <Skeleton class="h-8 w-full rounded" />
          <Skeleton v-for="i in 3" :key="i" class="h-10 w-full rounded" />
        </div>
      </div>
    </template>

    <!-- Error -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center">
      <p class="text-sm text-destructive">{{ error }}</p>
    </div>

    <!-- Editor -->
    <template v-else-if="timeline">

      <EditorToolbar
        :timeline="timeline"
        :px-per-frame="pxPerFrame"
        :playhead-frame="playheadFrame"
        :is-playing="isPlaying"
        :peers="sync.peers.value"
        :sync-connected="sync.connected.value"
        @go-back="goBack"
        @zoom-in="zoomIn"
        @zoom-out="zoomOut"
        @add-track="addTrackOpen = true"
        @toggle-play="togglePlayback"
        @seek-start="seekStart"
        @seek-end="seekEnd"
      />

      <div class="flex flex-1 overflow-hidden">

        <!-- Left panel: track headers -->
        <div class="w-56 shrink-0 border-r border-border flex flex-col overflow-hidden">
          <div class="h-8 shrink-0 border-b border-border bg-muted/40" />

          <div ref="trackHeadersRef" class="flex-1 overflow-y-hidden">
            <TrackHeader
              v-for="track in trackList"
              :key="track.id"
              :track="track"
              @toggle-mute="toggleMute(track)"
              @toggle-lock="toggleLock(track)"
              @add-clip="openAddClip(track)"
              @delete="deleteTrack(track)"
            />
            <div v-if="trackList.length === 0" class="px-4 py-6 text-xs text-muted-foreground text-center">
              {{ $t('editor.noTracks') }}
            </div>
          </div>

          <button
            class="shrink-0 border-t border-border px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center gap-1.5 w-full"
            @click="addTrackOpen = true"
          >
            <span class="text-base leading-none">+</span>
            {{ $t('editor.addTrack') }}
          </button>
        </div>

        <!-- Right panel: canvas -->
        <div ref="canvasRef" class="flex-1 overflow-auto relative" @scroll="onCanvasScroll" @wheel="onCanvasWheel">
          <div :style="{ width: timelineWidth + 'px', minWidth: '100%', position: 'relative' }">

            <Ruler
              :timeline="timeline"
              :px-per-frame="pxPerFrame"
              :playhead-frame="playheadFrame"
              @scrub="onScrubStart"
            />

            <div class="relative" :style="{ minHeight: (trackList.length * 40) + 'px' }">
              <!-- Playhead line -->
              <div
                class="absolute top-0 bottom-0 w-px bg-primary/70 pointer-events-none z-10"
                :style="{ left: playheadX + 'px' }"
              />

              <TrackLane
                v-for="track in trackList"
                :key="track.id"
                :track="track"
                :timeline="timeline"
                :px-per-frame="pxPerFrame"
                @edit-clip="openEditClip(track, $event)"
                @delete-clip="deleteClip(track, $event)"
                @crop-clip="cropClip(track, $event.clip, $event.fields)"
                @move-clip="moveClip(track, $event.clip, $event.position)"
              />

              <div v-if="trackList.length === 0" class="absolute inset-0 flex items-center justify-center">
                <p class="text-sm text-muted-foreground">{{ $t('editor.addTrackHint') }}</p>
              </div>
            </div>

          </div>
        </div>

      </div>
    </template>

    <AddTrackDialog
      :open="addTrackOpen"
      :track-types="trackTypes"
      :timeline-id="route.params.tlId"
      @update:open="addTrackOpen = $event"
      @created="onTrackAdded"
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

  </div>
</template>
