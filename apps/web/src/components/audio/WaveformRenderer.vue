<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  samples:      { type: Array,  default: () => [] },  // mono, or LEFT channel when stereo
  samplesRight: { type: Array,  default: () => [] },  // RIGHT channel — enables stereo when non-empty
  progress:     { type: Number, default: 0 },
  barWidth:     { type: Number, default: 2 },
  barGap:       { type: Number, default: 1.5 },
})
const emit = defineEmits(['seek'])

const canvas      = ref(null)
const clrPrimary  = ref(null)
const clrUnplayed = ref(null)
const hoverFrac   = ref(-1)

// Spring: slightly underdamped so sine-wave velocity carries through naturally
const SPRING_K = 120  // stiffness (px/s² per px of displacement)
const SPRING_D = 20   // damping   (ratio ≈ 0.91 — tiny natural overshoot, glide feel)
const MIN_H    = 2

let ctx = null, ro = null, mo = null, raf = null
let mode = 'idle'                              // 'idle' | 'sine' | 'spring'
let channels = []                             // [{ live, prev, to, springs }] — 1 (mono) or 2 (stereo)
let cssW = 0, cssH = 0, dpr = 1
let sineStart = 0, lastT = 0
let colPrimary = '#000', colUnplayed = '#000'  // cached; re-read only on theme change

const step        = () => props.barWidth + props.barGap
const count       = () => Math.floor(cssW / step())
const isStereo    = () => props.samplesRight.length > 0
const chanSamples = () => (isStereo() ? [props.samples, props.samplesRight] : [props.samples])
// per-channel max bar extent: full height for mono, ~half per side for stereo (small center gap)
const chanMaxH    = () => (isStereo() ? cssH * 0.44 : cssH * 0.88)

function resample(arr, n) {
  if (arr.length === n) return arr.slice()
  return Array.from({ length: n }, (_, i) => {
    const j = Math.round((i / (n - 1 || 1)) * (arr.length - 1))
    return arr[Math.min(Math.max(j, 0), arr.length - 1)] ?? MIN_H
  })
}

function computeTargets(samples, n, maxH) {
  const len = samples.length
  return Array.from({ length: n }, (_, i) => {
    let sum = 0, cnt = 0
    for (let j = Math.floor(i / n * len); j < Math.ceil((i + 1) / n * len) && j < len; j++) {
      sum += samples[j] ?? 0; cnt++
    }
    return Math.max(MIN_H, (cnt ? sum / cnt : 0) * maxH)
  })
}
const computeAll = () => {
  const n = count(), m = chanMaxH()
  return chanSamples().map((s) => computeTargets(s, n, m))
}

function sineH(i, n, maxH, t) {
  const x    = (i / (n - 1 || 1)) * Math.PI * 2
  const wave = Math.sin(x * 10 - t) * 0.25 + Math.sin(x * 4.1 - t * 1.3) * 0.25
  return Math.max(MIN_H, (wave * 0.35 + 0.45) * maxH)
}

// Build/trim the channel list to match mono/stereo, seeding new channels from existing bars (no pop).
function ensureChannels(n) {
  const wanted = isStereo() ? 2 : 1
  if (channels.length === wanted && channels[0]) return
  const prev = channels
  const seed = prev[0]?.live?.length ? prev[0].live : new Array(n).fill(MIN_H)
  channels = Array.from({ length: wanted }, (_, c) => ({
    live: (prev[c]?.live?.length ? prev[c].live : seed).slice(),
    prev: [], to: [], springs: [],
  }))
}

function readColors() {
  if (clrPrimary.value)  colPrimary  = getComputedStyle(clrPrimary.value).color
  if (clrUnplayed.value) colUnplayed = getComputedStyle(clrUnplayed.value).color
}

// Resize the backing store only when CSS size or DPR actually changes — not per frame.
function syncSize() {
  const el = canvas.value; if (!el) return false
  const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return false
  dpr = window.devicePixelRatio || 1
  const bw = Math.round(w * dpr), bh = Math.round(h * dpr)
  if (el.width !== bw || el.height !== bh) { el.width = bw; el.height = bh }
  cssW = w; cssH = h
  return true
}

function renderFrame() {
  const el = canvas.value
  if (!ctx || !el || !cssW || !cssH || !channels[0]) return
  if ((window.devicePixelRatio || 1) !== dpr) syncSize()  // reallocs only on a real DPR change
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)

  const s = step(), w = props.barWidth, r = w / 2
  const stereo = channels.length > 1
  const mid = cssH / 2
  const n = channels[0].live.length
  const cutoff   = props.progress * n
  const hoverBar = hoverFrac.value >= 0 ? hoverFrac.value * n : -1

  for (let i = 0; i < n; i++) {
    const played = i < cutoff
    ctx.fillStyle   = played ? colPrimary : colUnplayed
    ctx.globalAlpha = played ? 1 : (hoverBar >= 0 && i < hoverBar ? 0.45 : 0.25)
    const x = i * s
    if (stereo) {
      const lH = channels[0].live[i] ?? MIN_H
      const rH = channels[1].live[i] ?? MIN_H
      ctx.beginPath(); ctx.roundRect(x, mid - lH, w, lH, [r, r, 0, 0]); ctx.fill()  // left  ↑ from center
      ctx.beginPath(); ctx.roundRect(x, mid,      w, rH, [0, 0, r, r]); ctx.fill()  // right ↓ from center
    } else {
      const h0 = channels[0].live[i] ?? MIN_H
      ctx.beginPath(); ctx.roundRect(x, (cssH - h0) / 2, w, h0, r); ctx.fill()       // centered (mono)
    }
  }

  ctx.globalAlpha = 1
  if (props.progress > 0) {
    ctx.fillStyle = colPrimary; ctx.globalAlpha = 0.9
    ctx.fillRect(props.progress * cssW - 0.5, 0, 1, cssH)
  }
  if (hoverFrac.value >= 0) {
    ctx.fillStyle = colPrimary; ctx.globalAlpha = 0.3
    ctx.fillRect(hoverFrac.value * cssW - 0.5, 0, 1, cssH)
  }
  ctx.globalAlpha = 1
}

// Single rAF driver for both the idle sine and the spring settle — across all channels.
function loop(now) {
  const dt = Math.min((now - lastT) / 1000, 0.05); lastT = now

  if (mode === 'sine') {
    const t = (now - sineStart) * 0.002, maxH = chanMaxH()
    channels.forEach((ch, c) => {
      const n = ch.live.length
      ch.prev = ch.live
      ch.live = Array.from({ length: n }, (_, i) => sineH(i, n, maxH, t + c * 0.7))  // phase-offset R
    })
  } else if (mode === 'spring') {
    let settled = true
    channels.forEach((ch) => {
      ch.live = ch.springs.map((sp) => {
        sp.vel += ((sp.target - sp.pos) * SPRING_K - sp.vel * SPRING_D) * dt
        sp.pos  = Math.max(MIN_H, sp.pos + sp.vel * dt)
        if (Math.abs(sp.target - sp.pos) > 0.4 || Math.abs(sp.vel) > 4) settled = false
        return sp.pos
      })
    })
    if (settled) { channels.forEach((ch) => { ch.live = ch.to.slice() }); mode = 'idle' }
  }

  renderFrame()
  raf = mode === 'idle' ? null : requestAnimationFrame(loop)
}

function kick() { lastT = performance.now(); if (!raf) raf = requestAnimationFrame(loop) }

function startSine() {
  const n = count() || channels[0]?.live.length || 0
  ensureChannels(n)
  channels.forEach((ch) => { ch.live = resample(ch.live, n); ch.prev = ch.live.slice() })
  mode = 'sine'; sineStart = performance.now(); kick()
}

function startSpring(targetsList) {
  ensureChannels(targetsList[0].length)
  const cap = chanMaxH()  // cap seed so a mono→stereo height change can't overshoot past center
  channels.forEach((ch, c) => {
    const targets = targetsList[c] ?? targetsList[0]
    ch.live = resample(ch.live, targets.length).map((v) => Math.min(v, cap))
    ch.to = targets
    // seed velocity from the last two sine frames (~16ms → ×60 ≈ px/s)
    ch.springs = ch.live.map((pos, i) => ({
      pos, target: targets[i] ?? pos, vel: (pos - (ch.prev[i] ?? pos)) * 60,
    }))
  })
  mode = 'spring'; kick()
}

function draw() { if (mode === 'idle') renderFrame() }

function onResize() {
  if (!syncSize()) return
  const n = count()
  ensureChannels(n)
  if (mode === 'idle') {
    const t = props.samples.length ? computeAll() : channels.map(() => new Array(n).fill(MIN_H))
    channels.forEach((ch, c) => { ch.live = t[c] })
  } else {
    channels.forEach((ch) => {
      ch.live = resample(ch.live, n)
      if (mode === 'spring') {
        ch.to = resample(ch.to, n)
        ch.springs = ch.live.map((pos, i) => ({ pos, target: ch.to[i] ?? pos, vel: ch.springs[i]?.vel ?? 0 }))
      }
    })
  }
  renderFrame()
}

function getFrac(e) {
  const r = canvas.value.getBoundingClientRect()
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
}
function onPointerDown(e) { canvas.value.setPointerCapture(e.pointerId); emit('seek', getFrac(e)) }
function onPointerMove(e) { hoverFrac.value = getFrac(e); e.buttons > 0 ? emit('seek', hoverFrac.value) : draw() }
function onPointerLeave()  { hoverFrac.value = -1; draw() }

onMounted(() => {
  const el = canvas.value
  ctx = el.getContext('2d')
  readColors()
  syncSize()
  ro = new ResizeObserver(onResize); ro.observe(el)
  mo = new MutationObserver(() => { readColors(); draw() })
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  startSine()
})

onBeforeUnmount(() => { ro?.disconnect(); mo?.disconnect(); if (raf) cancelAnimationFrame(raf) })

// Reveal on first samples; re-spring when toggling between mono and stereo.
watch(
  [() => props.samples.length, () => props.samplesRight.length],
  ([len, rlen], [pLen = 0, pRlen = 0]) => {
    if (!cssW) return
    const stereo = rlen > 0, prevStereo = pRlen > 0
    if (len && !pLen) startSpring(computeAll())
    else if (len && stereo !== prevStereo) { ensureChannels(count()); startSpring(computeAll()) }
  },
)
watch(() => props.progress, draw)
</script>

<template>
  <div class="relative w-full h-full">
    <span ref="clrPrimary"  class="sr-only text-primary" />
    <span ref="clrUnplayed" class="sr-only text-foreground" />
    <canvas
      ref="canvas"
      class="w-full h-full cursor-pointer select-none touch-none"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
    />
  </div>
</template>