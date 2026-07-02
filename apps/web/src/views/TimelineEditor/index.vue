<script setup>
import { ref, computed, provide, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Skeleton } from '@starling/ui'
import { useApi } from '../../composables/useApi.js'
import { usePageTitle } from '../../composables/usePageTitle.js'
import { clamp } from './useEditorUtils.js'
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
}

onMounted(load)

usePageTitle(computed(() => timeline.value ? `${timeline.value.name} — ${t('editor.title')}` : null))

// ── Zoom ──────────────────────────────────────────────────────────────────────
const ZOOM_STEPS    = [0.25, 0.5, 1, 2, 4, 8, 16, 32]
const pxPerFrame    = ref(2)
const timelineWidth = computed(() =>
  timeline.value ? (timeline.value.endFrame - timeline.value.startFrame) * pxPerFrame.value : 0,
)
function zoomIn()  {
  const i = ZOOM_STEPS.indexOf(pxPerFrame.value)
  if (i < ZOOM_STEPS.length - 1) pxPerFrame.value = ZOOM_STEPS[i + 1]
}
function zoomOut() {
  const i = ZOOM_STEPS.indexOf(pxPerFrame.value)
  if (i > 0) pxPerFrame.value = ZOOM_STEPS[i - 1]
}

// ── Playhead ──────────────────────────────────────────────────────────────────
// Stored as float for smooth animation; TC display rounds it.
const playheadFrame = ref(0)
watch(timeline, tl => { if (tl) playheadFrame.value = tl.startFrame }, { immediate: true })

const playheadX = computed(() =>
  timeline.value ? (playheadFrame.value - timeline.value.startFrame) * pxPerFrame.value : 0,
)

function seekStart() {
  stopPlayback()
  playheadFrame.value = timeline.value?.startFrame ?? 0
}

// ── Playback ──────────────────────────────────────────────────────────────────
const isPlaying = ref(false)
let _rafId  = null
let _lastTs = null

function startPlayback() {
  if (!timeline.value) return
  if (playheadFrame.value >= timeline.value.endFrame) {
    playheadFrame.value = timeline.value.startFrame
  }
  isPlaying.value = true
  _lastTs         = null
  _rafId          = requestAnimationFrame(_tick)

  const fps      = parseFloat(timeline.value.frameRate)
  const allClips = trackList.value.flatMap(t => t.clips)
  startAudioPlayback(allClips, playheadFrame.value, fps)
}

function stopPlayback() {
  isPlaying.value = false
  if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null }
  _lastTs = null
  stopAudioPlayback()
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
  _rafId = requestAnimationFrame(_tick)
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
function onKeydown(e) {
  const tag = e.target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return
  if (e.code === 'Space') { e.preventDefault(); togglePlayback() }
  if (e.code === 'Home')  { e.preventDefault(); seekStart() }
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  stopPlayback()
  destroyAudioEngine()
})

// ── Scroll sync ───────────────────────────────────────────────────────────────
const canvasRef       = ref(null)
const trackHeadersRef = ref(null)

function onCanvasScroll() {
  if (trackHeadersRef.value && canvasRef.value) {
    trackHeadersRef.value.scrollTop = canvasRef.value.scrollTop
  }
}

// ── Ruler click → set playhead ────────────────────────────────────────────────
function onRulerClick(e) {
  if (!canvasRef.value || !timeline.value) return
  const rect  = canvasRef.value.getBoundingClientRect()
  const x     = e.clientX - rect.left + canvasRef.value.scrollLeft
  const frame = timeline.value.startFrame + x / pxPerFrame.value
  playheadFrame.value = clamp(frame, timeline.value.startFrame, timeline.value.endFrame)
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
  trackList.value.push({ ...track, clips: [] })
}

async function toggleMute(track) {
  const { ok, data } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/timelines/${route.params.tlId}/tracks/${track.id}`,
    { method: 'PATCH', json: { isMuted: !track.isMuted }, silent: true },
  )
  if (ok) {
    const idx = trackList.value.findIndex(t => t.id === track.id)
    if (idx !== -1) trackList.value[idx] = { ...trackList.value[idx], ...data }
  }
}

async function toggleLock(track) {
  const { ok, data } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/timelines/${route.params.tlId}/tracks/${track.id}`,
    { method: 'PATCH', json: { isLocked: !track.isLocked }, silent: true },
  )
  if (ok) {
    const idx = trackList.value.findIndex(t => t.id === track.id)
    if (idx !== -1) trackList.value[idx] = { ...trackList.value[idx], ...data }
  }
}

async function deleteTrack(track) {
  const { ok } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/timelines/${route.params.tlId}/tracks/${track.id}`,
    { method: 'DELETE', silent: true },
  )
  if (ok) trackList.value = trackList.value.filter(t => t.id !== track.id)
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
  const idx = trackList.value.findIndex(t => t.id === clipDialog.value.track?.id)
  if (idx === -1) return
  const clips = trackList.value[idx].clips
  const ci    = clips.findIndex(c => c.id === savedClip.id)
  if (ci !== -1) clips[ci] = savedClip
  else           clips.push(savedClip)
  clips.sort((a, b) => a.position - b.position)
  closeClipDialog()
}

async function moveClip(track, clip, position) {
  const { ok, data } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/timelines/${route.params.tlId}/tracks/${track.id}/clips/${clip.id}`,
    { method: 'PATCH', json: { position }, silent: true },
  )
  if (!ok) return
  const ti = trackList.value.findIndex(t => t.id === track.id)
  if (ti === -1) return
  const ci = trackList.value[ti].clips.findIndex(c => c.id === clip.id)
  if (ci !== -1) {
    trackList.value[ti].clips[ci] = { ...trackList.value[ti].clips[ci], ...data }
    trackList.value[ti].clips.sort((a, b) => a.position - b.position)
  }
}

async function cropClip(track, clip, fields) {
  const { ok, data } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/timelines/${route.params.tlId}/tracks/${track.id}/clips/${clip.id}`,
    { method: 'PATCH', json: fields, silent: true },
  )
  if (!ok) return
  const ti = trackList.value.findIndex(t => t.id === track.id)
  if (ti === -1) return
  const ci = trackList.value[ti].clips.findIndex(c => c.id === clip.id)
  if (ci !== -1) trackList.value[ti].clips[ci] = { ...trackList.value[ti].clips[ci], ...data }
}

async function deleteClip(track, clip) {
  const { ok } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/timelines/${route.params.tlId}/tracks/${track.id}/clips/${clip.id}`,
    { method: 'DELETE', silent: true },
  )
  if (ok) {
    const idx = trackList.value.findIndex(t => t.id === track.id)
    if (idx !== -1) trackList.value[idx].clips = trackList.value[idx].clips.filter(c => c.id !== clip.id)
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────
function goBack() {
  stopPlayback()
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
        @go-back="goBack"
        @zoom-in="zoomIn"
        @zoom-out="zoomOut"
        @add-track="addTrackOpen = true"
        @toggle-play="togglePlayback"
        @seek-start="seekStart"
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
        <div ref="canvasRef" class="flex-1 overflow-auto relative" @scroll="onCanvasScroll">
          <div :style="{ width: timelineWidth + 'px', minWidth: '100%', position: 'relative' }">

            <Ruler
              :timeline="timeline"
              :px-per-frame="pxPerFrame"
              :playhead-frame="playheadFrame"
              @click="onRulerClick"
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
