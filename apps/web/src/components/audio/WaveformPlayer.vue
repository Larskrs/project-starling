<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { Icon } from '@iconify/vue'
import WaveformRenderer from './WaveformRenderer.vue'

const props = defineProps({
  src: { type: String, required: true },
})

const BARS = 140

// ── Waveform analysis ──────────────────────────────────────────────────────
const samples      = ref([])              // left / mono
const samplesRight = ref([])              // right channel — empty ⇒ mono
const analyzeError = ref(false)
const audioSrc     = ref(props.src)       // swapped to an in-memory blob URL after fetch (single download)

let audioCtx = null
let analyzeToken = 0                       // guards against a stale analyze resolving after a newer src
let objectUrl = null

function releaseUrl() {
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null }
}

// Proportional bucketing — covers every sample (no dropped tail) and is safe when data is short.
function bucketize(data) {
  const n = data.length, out = new Array(BARS)
  for (let i = 0; i < BARS; i++) {
    const start = Math.floor(i * n / BARS)
    const end   = Math.floor((i + 1) * n / BARS)
    let sum = 0
    for (let j = start; j < end; j++) sum += Math.abs(data[j])
    out[i] = end > start ? sum / (end - start) : 0
  }
  return out
}

async function analyze(src) {
  const token = ++analyzeToken
  samples.value      = []
  samplesRight.value = []
  analyzeError.value = false

  try {
    const res = await fetch(src, { credentials: 'include' })
    const buf = await res.arrayBuffer()
    if (token !== analyzeToken) return

    // Reuse the downloaded bytes for playback → no second network request, instant play.
    // Blob copies buf here, before decodeAudioData may detach it.
    releaseUrl()
    objectUrl = URL.createObjectURL(new Blob([buf]))
    audioSrc.value = objectUrl

    audioCtx ??= new AudioContext()         // reused across tracks — avoids the per-context browser limit
    const decoded = await audioCtx.decodeAudioData(buf)
    if (token !== analyzeToken) return

    const left  = bucketize(decoded.getChannelData(0))
    const right = decoded.numberOfChannels > 1 ? bucketize(decoded.getChannelData(1)) : null

    // Normalise both channels against a shared peak so relative L/R loudness is preserved.
    let max = 1e-9
    for (const v of left) if (v > max) max = v
    if (right) for (const v of right) if (v > max) max = v

    samples.value      = left.map((v) => v / max)
    samplesRight.value = right ? right.map((v) => v / max) : []
  } catch {
    if (token === analyzeToken) {
      analyzeError.value = true
      releaseUrl()
      audioSrc.value = src                   // fall back to streaming the raw URL
    }
  }
}

// ── Playback ───────────────────────────────────────────────────────────────
const audioEl     = ref(null)
const playing     = ref(false)
const muted       = ref(false)
const volume      = ref(1)
const progress    = ref(0)
const currentTime = ref(0)
const duration    = ref(0)

function togglePlay() {
  if (!audioEl.value) return
  playing.value ? audioEl.value.pause() : audioEl.value.play()
}

function toggleMute() {
  muted.value = !muted.value
  if (audioEl.value) audioEl.value.muted = muted.value
}

function setVolume(e) { applyVolume(parseFloat(e.target.value)) }

function applyVolume(v) {
  volume.value = v
  if (audioEl.value) audioEl.value.volume = v
  if (v > 0 && muted.value) {
    muted.value = false
    if (audioEl.value) audioEl.value.muted = false
  }
}

function onTimeUpdate() {
  const el = audioEl.value
  if (!el) return
  currentTime.value = el.currentTime
  progress.value    = el.duration ? el.currentTime / el.duration : 0
}

function onLoadedMetadata() { duration.value = audioEl.value.duration }

function onEnded() {
  playing.value     = false
  progress.value    = 0
  currentTime.value = 0
}

function seek(frac) {
  if (!audioEl.value || !duration.value) return
  audioEl.value.currentTime = frac * duration.value
  progress.value = frac
}

function seekBy(secs) {
  if (!audioEl.value || !duration.value) return
  const t = Math.max(0, Math.min(duration.value, audioEl.value.currentTime + secs))
  audioEl.value.currentTime = t
  progress.value = t / duration.value
}

function fmt(secs) {
  if (!isFinite(secs)) return '0:00'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const volumeIcon = computed(() => {
  if (muted.value || volume.value === 0) return 'mdi:volume-off'
  if (volume.value < 0.4)  return 'mdi:volume-low'
  if (volume.value < 0.75) return 'mdi:volume-medium'
  return 'mdi:volume-high'
})

// ── Keyboard shortcuts ─────────────────────────────────────────────────────
// Registered in capture phase so we can stopImmediatePropagation before the
// overlay's bubble-phase arrow-key handler fires when audio is playing.
function onKeydown(e) {
  if (e.target instanceof HTMLInputElement) return

  if (e.key === ' ') {
    e.preventDefault(); e.stopPropagation(); togglePlay(); return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault(); e.stopPropagation()
    applyVolume(Math.min(1, Math.round((volume.value + 0.1) * 10) / 10)); return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault(); e.stopPropagation()
    applyVolume(Math.max(0, Math.round((volume.value - 0.1) * 10) / 10)); return
  }
  // Arrow seek only while playing — otherwise let the overlay navigate files
  if (playing.value && e.key === 'ArrowLeft') {
    e.preventDefault(); e.stopImmediatePropagation(); seekBy(-5); return
  }
  if (playing.value && e.key === 'ArrowRight') {
    e.preventDefault(); e.stopImmediatePropagation(); seekBy(5); return
  }
}

onMounted(() => {
  analyze(props.src)
  window.addEventListener('keydown', onKeydown, { capture: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, { capture: true })
  releaseUrl()
  audioCtx?.close()
})
watch(() => props.src, analyze)
</script>

<template>
  <div class="rounded-xl border border-border bg-card w-full select-none overflow-hidden">

    <!-- Waveform area -->
    <div class="px-4 pt-4 pb-2 h-20">
      <div v-if="analyzeError" class="flex items-center justify-center h-full">
        <p class="text-xs text-muted-foreground">Could not read audio</p>
      </div>
      <WaveformRenderer
        v-else
        :samples="samples"
        :samples-right="samplesRight"
        :progress="progress"
        @seek="seek"
      />
    </div>

    <!-- Divider -->
    <div class="h-px bg-border mx-4" />

    <!-- Controls -->
    <div class="flex items-center gap-2 px-3 py-2.5">

      <!-- Play / pause -->
      <button
        class="shrink-0 size-8 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/85 active:scale-95 transition-all"
        @click="togglePlay"
      >
        <Icon :icon="playing ? 'mdi:pause' : 'mdi:play'" class="text-base" />
      </button>

      <!-- Current time -->
      <span class="text-xs tabular-nums text-muted-foreground w-9 shrink-0 text-center">
        {{ fmt(currentTime) }}
      </span>

      <div class="flex-1" />

      <!-- Duration -->
      <span class="text-xs tabular-nums text-muted-foreground shrink-0 w-9 text-center">
        {{ fmt(duration) }}
      </span>

      <!-- Volume -->
      <div class="flex items-center gap-1.5 shrink-0">
        <button
          class="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
          @click="toggleMute"
        >
          <Icon :icon="volumeIcon" class="text-base" />
        </button>
        <input
          type="range"
          min="0" max="1" step="0.02"
          :value="muted ? 0 : volume"
          class="w-16 h-1 accent-primary cursor-pointer"
          @input="setVolume"
        />
      </div>

    </div>

    <audio
      ref="audioEl"
      :src="audioSrc"
      preload="metadata"
      @timeupdate="onTimeUpdate"
      @loadedmetadata="onLoadedMetadata"
      @play="playing = true"
      @pause="playing = false"
      @ended="onEnded"
    />
  </div>
</template>