<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { Button, PromptDialog } from '@starling/ui'

import Ruler       from '../TimelineEditor/components/Ruler.vue'
import TrackHeader from '../TimelineEditor/components/TrackHeader.vue'
import TrackLane   from '../TimelineEditor/components/TrackLane.vue'
import SourceBar   from '../TimelineEditor/components/SourceBar.vue'
import RulerLane   from '../TimelineEditor/behaviors/RulerLane.vue'
import { framesToTC, sourceIndexFromKey } from '../TimelineEditor/lib/editorUtils'
import { resolveTrackSettings, trackSupportsAudio } from '../TimelineEditor/behaviors/trackSettings'
import { useEditorViewport } from '../TimelineEditor/view/useEditorViewport'
import { useResizable } from '../../composables/useResizable'
import type { EditorClip, EditorTrack, Source } from '../../types/timeline'
import {
  DEMO_SOURCE_TRACK_ID, DEMO_TRACK_HEIGHTS,
  makeDemoClip, makeDemoSources, makeDemoTimeline, makeDemoTracks,
} from './demoTimeline'

/**
 * The welcome page's headline demo: the editor's own Ruler, TrackHeader,
 * TrackLane, RulerLane, EditorClip and SourceBar, mounted against local
 * fixtures instead of a timeline from the API.
 *
 * Everything a visitor can do here — scrub, drag, crop, cut cameras, mute,
 * lock, rename, delete — runs the same components the editor runs; only the
 * persistence is missing, so `reset` is the whole undo story.
 *
 * The editor's own toolbar isn't reused: its first control is "back to the
 * timeline list", which has nowhere to go from a marketing page.
 */
const emit = defineEmits<{ interacted: [] }>()

const timeline = ref(makeDemoTimeline())
const tracks   = ref<EditorTrack[]>(makeDemoTracks())
const sources  = ref<Source[]>(makeDemoSources())
const heights  = ref<Record<string, number>>({ ...DEMO_TRACK_HEIGHTS })

// The culling contract the real lanes read: clips, ticks and chips all derive
// their visible slice from this, so the demo scrolls as cheaply as the editor.
const { canvasRef, trackHeadersRef, viewport, updateViewport, onCanvasScroll } = useEditorViewport()
provide('editor-viewport', viewport)
provide('editor-sources',  sources)

onMounted(updateViewport)

// ── Zoom ──────────────────────────────────────────────────────────────────────
// A flat default rather than a fit-to-width one: at 0.5 the 90-second demo is
// wider than most cards, so the canvas scrolls out of the box — which is half
// of what a timeline feels like.
const DEFAULT_PX_PER_FRAME = 0.5
const pxPerFrame = ref(DEFAULT_PX_PER_FRAME)

const totalFrames   = computed(() => timeline.value.endFrame - timeline.value.startFrame)
const timelineWidth = computed(() => totalFrames.value * pxPerFrame.value)
const zoomLabel     = computed(() => `${Math.round((pxPerFrame.value / DEFAULT_PX_PER_FRAME) * 100)}%`)

function zoom(factor: number): void {
  pxPerFrame.value = Math.min(2, Math.max(0.15, pxPerFrame.value * factor))
  updateViewport()
}

// ── Transport ─────────────────────────────────────────────────────────────────
// A bare rAF clock. The editor's usePlayback owns an audio engine and a socket;
// neither belongs on a page a visitor lands on with no session.
const playhead  = ref(0)
const isPlaying = ref(false)

let raf: number | null = null
let lastTs = 0

function tick(ts: number): void {
  const fps  = parseFloat(timeline.value.frameRate) || 25
  const next = playhead.value + ((ts - lastTs) / 1000) * fps
  lastTs = ts
  playhead.value = next >= timeline.value.endFrame ? timeline.value.startFrame : next
  followPlayhead()
  raf = requestAnimationFrame(tick)
}

function stop(): void {
  isPlaying.value = false
  if (raf) { cancelAnimationFrame(raf); raf = null }
}

function togglePlay(): void {
  touched()
  if (isPlaying.value) { stop(); return }
  isPlaying.value = true
  lastTs = performance.now()
  raf = requestAnimationFrame(tick)
}

onBeforeUnmount(stop)

/** Keep a running playhead on screen once it passes three quarters across. */
function followPlayhead(): void {
  const el = canvasRef.value
  if (!el) return
  const x = (playhead.value - timeline.value.startFrame) * pxPerFrame.value
  if (x > el.scrollLeft + el.clientWidth * 0.75) el.scrollLeft = x - el.clientWidth * 0.5
  else if (x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 24)
}

const tc = computed(() => framesToTC(playhead.value, timeline.value.frameRate))

// ── Scrubbing ─────────────────────────────────────────────────────────────────
function frameFromPointer(e: PointerEvent): number {
  const el = canvasRef.value
  if (!el) return 0
  const rect = el.getBoundingClientRect()
  return timeline.value.startFrame + (e.clientX - rect.left + el.scrollLeft) / pxPerFrame.value
}

function setPlayhead(frame: number): void {
  playhead.value = Math.min(timeline.value.endFrame, Math.max(timeline.value.startFrame, frame))
}

function onScrubMove(e: PointerEvent): void { setPlayhead(frameFromPointer(e)) }
function onScrubEnd(): void {
  window.removeEventListener('pointermove', onScrubMove)
  window.removeEventListener('pointerup',   onScrubEnd)
}
function onScrubStart(e: PointerEvent): void {
  touched()
  stop()
  setPlayhead(frameFromPointer(e))
  window.addEventListener('pointermove', onScrubMove)
  window.addEventListener('pointerup',   onScrubEnd)
}

onBeforeUnmount(onScrubEnd)

// ── Track behaviour, order and geometry ───────────────────────────────────────
// The demo tracks carry their type's behaviour columns inline, so the editor's
// own resolver answers without a trackTypes list to look them up in.
const settingsFor  = (track: EditorTrack) => resolveTrackSettings(track)
const isStripTrack = (track: EditorTrack) => settingsFor(track).trackDisplay !== 'normal'

const orderedTracks = computed(() => [...tracks.value].sort((a, b) => a.sortOrder - b.sortOrder))
const trackHeight   = (track: EditorTrack) => heights.value[track.id] ?? 44
const totalHeight   = computed(() => orderedTracks.value.reduce((sum, t) => sum + trackHeight(t), 0))

// The editor's canvas is taller than its tracks — there is always empty lane
// below the last row, which is where the source switcher floats. The demo
// reserves the same room rather than letting the switcher cover the timeline.
const RULER_HEIGHT    = 32
const SOURCE_BAR_ROOM = 128
const bodyHeight      = computed(() => totalHeight.value + RULER_HEIGHT + SOURCE_BAR_ROOM)

const playheadX = computed(() => (playhead.value - timeline.value.startFrame) * pxPerFrame.value)

// Client-local in the editor too — the level never reaches the server there
// either, so keeping it in a ref is the honest reproduction.
const volumes     = ref<Record<string, number>>({})
const trackVolume = (track: EditorTrack) => volumes.value[track.id] ?? 1

const rowResizer = useResizable({ axis: 'y', min: 28, max: 120 })
function startRowResize(track: EditorTrack, e: PointerEvent): void {
  touched()
  rowResizer.start(e, {
    get: () => trackHeight(track),
    set: (h) => { heights.value = { ...heights.value, [track.id]: h } },
  })
}

// ── Selection & the source switcher ───────────────────────────────────────────
const selectedTrackId = ref<string | null>(DEMO_SOURCE_TRACK_ID)
const selectedTrack   = computed(() => tracks.value.find(t => t.id === selectedTrackId.value) ?? null)
const showSourceBar   = computed(() => selectedTrack.value?.id === DEMO_SOURCE_TRACK_ID)

/** Which take is on air at the playhead — the last cut at or before it. */
const activeSourceId = computed(() => {
  const track = tracks.value.find(t => t.id === DEMO_SOURCE_TRACK_ID)
  if (!track) return null
  let current: string | null = null
  for (const clip of track.clips) {
    if (clip.position > playhead.value) break
    current = clip.sourceId
  }
  return current
})

const flashSourceId = ref<string | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | null = null

function flashSource(id: string): void {
  flashSourceId.value = id
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => { flashSourceId.value = null }, 260)
}

onBeforeUnmount(() => { if (flashTimer) clearTimeout(flashTimer) })

function selectTrack(track: EditorTrack): void {
  touched()
  selectedTrackId.value = selectedTrackId.value === track.id ? null : track.id
}

// ── Clip edits ────────────────────────────────────────────────────────────────
// Every mutation replaces the track's clip array rather than splicing it: the
// lanes key on clip identity, and a fresh array is the cheapest way to be sure
// a drag that lands mid-frame can't leave a stale render behind.
function updateClips(track: EditorTrack, next: EditorClip[]): void {
  touched()
  const sorted = [...next].sort((a, b) => a.position - b.position)
  tracks.value = tracks.value.map(t => (t.id === track.id ? { ...t, clips: sorted } : t))
}

function patchClip(track: EditorTrack, clip: EditorClip, fields: Partial<EditorClip>): void {
  updateClips(track, track.clips.map(c => (c.id === clip.id ? { ...c, ...fields } : c)))
}

function deleteClip(track: EditorTrack, clip: EditorClip): void {
  updateClips(track, track.clips.filter(c => c.id !== clip.id))
}

function addSourceClip(source: Source): void {
  const track = selectedTrack.value
  if (!track || track.isLocked) return
  flashSource(source.id)
  updateClips(track, [
    ...track.clips,
    makeDemoClip(track.id, { position: Math.round(playhead.value), sourceId: source.id }),
  ])
}

/** The header menu's "add clip" — a block on media tracks, a marker elsewhere. */
function addClip(track: EditorTrack): void {
  if (track.isLocked) return
  const position = Math.round(playhead.value)
  const isBlock  = track.mode === 'clip'
  updateClips(track, [
    ...track.clips,
    makeDemoClip(track.id, isBlock
      ? { position, mediaStart: 0, end: 150, label: 'New clip' }
      : { position, label: 'Cue', sourceId: sources.value[0]?.id ?? null }),
  ])
}

// ── Track edits ───────────────────────────────────────────────────────────────
function patchTrack(track: EditorTrack, fields: Partial<EditorTrack>): void {
  touched()
  tracks.value = tracks.value.map(t => (t.id === track.id ? { ...t, ...fields } : t))
}

function deleteTrack(track: EditorTrack): void {
  touched()
  tracks.value = tracks.value.filter(t => t.id !== track.id)
  if (selectedTrackId.value === track.id) selectedTrackId.value = null
}

// ── Renaming ──────────────────────────────────────────────────────────────────
// The editor's clip and track dialogs both save through the API, so the demo
// borrows the shared PromptDialog for the one field that has any meaning
// without a server: the name.
type RenameTarget =
  | { kind: 'clip';  track: EditorTrack; clip: EditorClip }
  | { kind: 'track'; track: EditorTrack }

const renameTarget = ref<RenameTarget | null>(null)
const renameOpen   = ref(false)

function openRename(target: RenameTarget): void {
  if (target.track.isLocked) return
  renameTarget.value = target
  renameOpen.value   = true
}

const renameValue = computed(() => {
  const target = renameTarget.value
  if (!target) return ''
  return target.kind === 'clip' ? target.clip.label : target.track.name
})

function submitRename(value: string): void {
  const target = renameTarget.value
  if (!target) return
  if (target.kind === 'clip') patchClip(target.track, target.clip, { label: value })
  else patchTrack(target.track, { name: value })
  renameOpen.value = false
}

// ── Keyboard ──────────────────────────────────────────────────────────────────
// Scoped to the demo's own focus: the digit hotkeys are the editor's, but a
// marketing page must not swallow keys typed anywhere else on it.
function onKeydown(e: KeyboardEvent): void {
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); return }
  if (!showSourceBar.value) return
  const index = sourceIndexFromKey(e)
  const source = index >= 0 ? sources.value[index] : undefined
  if (!source) return
  e.preventDefault()
  addSourceClip(source)
}

// ── Reset ─────────────────────────────────────────────────────────────────────
function reset(): void {
  stop()
  timeline.value        = makeDemoTimeline()
  tracks.value          = makeDemoTracks()
  sources.value         = makeDemoSources()
  heights.value         = { ...DEMO_TRACK_HEIGHTS }
  volumes.value         = {}
  pxPerFrame.value      = DEFAULT_PX_PER_FRAME
  playhead.value        = 0
  selectedTrackId.value = DEMO_SOURCE_TRACK_ID
}

// One signal to the page that the demo is being used, so a hint can retire.
let announced = false
function touched(): void {
  if (announced) return
  announced = true
  emit('interacted')
}
</script>

<template>
  <div
    class="relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm outline-none
           focus-visible:ring-2 focus-visible:ring-ring"
    tabindex="0"
    @keydown="onKeydown"
  >
    <!-- Transport -->
    <div class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
      <Icon icon="mdi:timeline-outline" class="size-4 shrink-0 text-muted-foreground" />
      <span class="truncate text-sm font-semibold">{{ timeline.name }}</span>
      <span class="hidden shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground sm:inline">
        {{ timeline.frameRate }}p
      </span>

      <div class="flex-1" />

      <Button variant="flat" class="h-7 w-9 p-0" :title="$t('editor.goToStart')" @click="stop(); setPlayhead(0)">
        <Icon icon="mdi:skip-backward" class="size-4" />
      </Button>
      <Button
        class="h-7 w-10 p-0"
        :class="isPlaying ? '' : 'bg-muted text-foreground hover:bg-hover'"
        :title="$t('editor.playPause')"
        @click="togglePlay"
      >
        <Icon :icon="isPlaying ? 'mdi:pause' : 'mdi:play'" class="size-5" />
      </Button>

      <span class="shrink-0 rounded-md bg-muted/60 px-2 py-1 font-mono text-sm tabular-nums">{{ tc }}</span>

      <div class="mx-1 hidden h-5 w-px shrink-0 bg-border sm:block" />

      <div class="hidden items-center gap-1 sm:flex">
        <Button variant="flat" class="h-7 w-8 p-0" :title="$t('editor.zoomOut')" @click="zoom(1 / 1.4)">
          <Icon icon="mdi:magnify-minus-outline" class="size-4" />
        </Button>
        <span class="w-11 text-center text-xs tabular-nums text-muted-foreground">{{ zoomLabel }}</span>
        <Button variant="flat" class="h-7 w-8 p-0" :title="$t('editor.zoomIn')" @click="zoom(1.4)">
          <Icon icon="mdi:magnify-plus-outline" class="size-4" />
        </Button>
      </div>

      <Button variant="flat" class="h-7 w-8 p-0" :title="$t('welcome.demo.reset')" @click="reset">
        <Icon icon="mdi:restore" class="size-4" />
      </Button>
    </div>

    <!-- Headers + canvas. Nothing scrolls vertically: the rows always fit. -->
    <div class="flex" :style="{ height: bodyHeight + 'px' }">
      <div class="flex w-36 shrink-0 flex-col border-r border-border sm:w-44">
        <div class="flex h-8 shrink-0 items-center gap-1.5 border-b border-border bg-muted/40 px-3">
          <Icon icon="mdi:layers-triple-outline" class="size-3.5 shrink-0 text-muted-foreground" />
          <span class="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {{ $t('editor.tracks') }}
          </span>
          <span class="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground/70">
            {{ orderedTracks.length }}
          </span>
        </div>

        <div ref="trackHeadersRef" class="relative flex-1 overflow-y-hidden">
          <TrackHeader
            v-for="track in orderedTracks"
            :key="track.id"
            :track="track"
            :height="trackHeight(track)"
            :selected="track.id === selectedTrackId"
            :resizable="!isStripTrack(track)"
            :muted="track.isMuted"
            :supports-audio="trackSupportsAudio(track)"
            :volume="trackVolume(track)"
            @update:volume="volumes = { ...volumes, [track.id]: $event }"
            @select="selectTrack(track)"
            @toggle-mute="patchTrack(track, { isMuted: !track.isMuted })"
            @toggle-lock="patchTrack(track, { isLocked: !track.isLocked })"
            @add-clip="addClip(track)"
            @settings="openRename({ kind: 'track', track })"
            @delete="deleteTrack(track)"
            @resize-start="startRowResize(track, $event)"
          />
        </div>
      </div>

      <div ref="canvasRef" class="relative flex-1 overflow-x-auto overflow-y-hidden" @scroll="onCanvasScroll">
        <div :style="{ width: timelineWidth + 'px', minWidth: '100%', position: 'relative' }">
          <Ruler
            :timeline="timeline"
            :px-per-frame="pxPerFrame"
            :playhead-frame="playhead"
            @scrub="onScrubStart"
          />

          <div class="relative" :style="{ minHeight: totalHeight + 'px' }">
            <div
              class="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-primary/70"
              :style="{ left: playheadX + 'px' }"
            />

            <template v-for="track in orderedTracks" :key="track.id">
              <RulerLane
                v-if="settingsFor(track).trackDisplay === 'ruler'"
                :track="track"
                :timeline="timeline"
                :px-per-frame="pxPerFrame"
                :height="trackHeight(track)"
                :selected="track.id === selectedTrackId"
                :muted="track.isMuted"
                @select="selectTrack(track)"
                @edit-clip="openRename({ kind: 'clip', track, clip: $event })"
                @delete-clip="deleteClip(track, $event)"
                @move-clip="patchClip(track, $event.clip, { position: $event.position })"
              />
              <TrackLane
                v-else
                :track="track"
                :timeline="timeline"
                :px-per-frame="pxPerFrame"
                :height="trackHeight(track)"
                :selected="track.id === selectedTrackId"
                :muted="track.isMuted"
                :name-display="settingsFor(track).nameDisplay"
                :clip-display="settingsFor(track).clipDisplay"
                @select="selectTrack(track)"
                @edit-clip="openRename({ kind: 'clip', track, clip: $event })"
                @delete-clip="deleteClip(track, $event)"
                @crop-clip="patchClip(track, $event.clip, $event.fields)"
                @move-clip="patchClip(track, $event.clip, { position: $event.position })"
              />
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- The editor's own source switcher, on the same track it opens for there -->
    <SourceBar
      v-if="showSourceBar && selectedTrack"
      :track="selectedTrack"
      :sources="sources"
      :tc="tc"
      :active-source-id="activeSourceId"
      :flash-source-id="flashSourceId"
      @add="addSourceClip"
      @close="selectedTrackId = null"
    />

    <PromptDialog
      v-model:open="renameOpen"
      :title="renameTarget?.kind === 'track' ? $t('editor.trackDialog.title') : $t('editor.editClipDialog.title')"
      :label="renameTarget?.kind === 'track' ? $t('editor.trackName') : $t('editor.clipLabel')"
      :submit-label="$t('editor.save')"
      :cancel-label="$t('editor.cancel')"
      :initial-value="renameValue"
      @submit="submitRename"
    />
  </div>
</template>
