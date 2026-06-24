<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import Dialog from './Dialog.vue'
import Button from './Button.vue'

const props = defineProps({
  file:        { type: File,   default: null },
  aspectRatio: { type: Number, default: 1 },
  maxOutput:   { type: Number, default: 1200 },
})

const emit = defineEmits(['crop', 'cancel'])

// ── Image loading ──────────────────────────────────────────────────────────────

const open         = computed(() => !!props.file)
const srcUrl       = ref('')
const imgEl        = ref(null)
const containerRef = ref(null)
const natW         = ref(0)
const natH         = ref(0)

watch(() => props.file, (file) => {
  if (srcUrl.value) URL.revokeObjectURL(srcUrl.value)
  natW.value   = 0
  natH.value   = 0
  srcUrl.value = file ? URL.createObjectURL(file) : ''
}, { immediate: true })

// ── Display scaling ───────────────────────────────────────────────────────────

const MAX_W = 600
const MAX_H = 400
const MIN_SIZE = 30

const scale = computed(() => {
  if (!natW.value || !natH.value) return 1
  return Math.min(MAX_W / natW.value, MAX_H / natH.value, 1)
})
const dispW = computed(() => Math.round(natW.value * scale.value))
const dispH = computed(() => Math.round(natH.value * scale.value))

// ── Crop box (display coords) ─────────────────────────────────────────────────

const box = reactive({ x: 0, y: 0, w: 0, h: 0 })

function initBox() {
  const ar = props.aspectRatio
  let bw = dispW.value
  let bh = bw / ar
  if (bh > dispH.value) { bh = dispH.value; bw = bh * ar }
  box.w = Math.round(bw)
  box.h = Math.round(bh)
  box.x = Math.round((dispW.value - box.w) / 2)
  box.y = Math.round((dispH.value - box.h) / 2)
}

function onImgLoad() {
  natW.value = imgEl.value.naturalWidth
  natH.value = imgEl.value.naturalHeight
  initBox()
}

// ── Pointer helpers ───────────────────────────────────────────────────────────

function localPos(e) {
  const r = containerRef.value.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

function addDrag(onMove) {
  const up = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', up) }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', up, { once: true })
}

// ── Move ──────────────────────────────────────────────────────────────────────

function onMoveDown(e) {
  e.preventDefault()
  const start = { cx: e.clientX, cy: e.clientY, bx: box.x, by: box.y }
  addDrag((e) => {
    box.x = Math.max(0, Math.min(dispW.value - box.w, start.bx + e.clientX - start.cx))
    box.y = Math.max(0, Math.min(dispH.value - box.h, start.by + e.clientY - start.cy))
  })
}

// ── Resize ────────────────────────────────────────────────────────────────────

// corner: 'tl' | 'tr' | 'bl' | 'br'
function onResizeDown(corner, e) {
  e.preventDefault()
  e.stopPropagation()

  const ar = props.aspectRatio
  const anchorX = corner.includes('l') ? box.x + box.w : box.x
  const anchorY = corner.includes('t') ? box.y + box.h : box.y

  addDrag((e) => {
    const { x } = localPos(e)

    let newW = corner.includes('l') ? anchorX - x : x - anchorX
    newW = Math.max(MIN_SIZE, newW)
    if (corner.includes('r')) newW = Math.min(newW, dispW.value - anchorX)
    if (corner.includes('l')) newW = Math.min(newW, anchorX)

    let newH = newW / ar
    if (corner.includes('b')) newH = Math.min(newH, dispH.value - anchorY)
    if (corner.includes('t')) newH = Math.min(newH, anchorY)
    newW = newH * ar

    box.w = Math.round(newW)
    box.h = Math.round(newH)
    box.x = Math.round(corner.includes('l') ? anchorX - newW : anchorX)
    box.y = Math.round(corner.includes('t') ? anchorY - newH : anchorY)
  })
}

// ── Enter key ────────────────────────────────────────────────────────────────

function onKeyDown(e) {
  if (open.value && e.key === 'Enter') { e.preventDefault(); applyCrop() }
}

onMounted(()   => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  if (srcUrl.value) URL.revokeObjectURL(srcUrl.value)
})

// ── Output ────────────────────────────────────────────────────────────────────

function applyCrop() {
  if (!natW.value) return
  const s  = scale.value
  const sx = Math.round(box.x / s)
  const sy = Math.round(box.y / s)
  const sw = Math.round(box.w / s)
  const sh = Math.round(box.h / s)

  const outScale = Math.min(props.maxOutput / sw, props.maxOutput / sh, 1)
  const outW     = Math.round(sw * outScale)
  const outH     = Math.round(sh * outScale)

  const canvas  = document.createElement('canvas')
  canvas.width  = outW
  canvas.height = outH
  canvas.getContext('2d').drawImage(imgEl.value, sx, sy, sw, sh, 0, 0, outW, outH)
  canvas.toBlob(blob => emit('crop', blob), 'image/jpeg', 0.92)
}
</script>

<template>
  <Dialog :open="open" class="max-w-[660px]" @close="$emit('cancel')">
    <div class="p-5 space-y-4">

      <p class="text-sm font-semibold text-foreground">Crop image</p>

      <!-- Image + overlay -->
      <div
        ref="containerRef"
        class="relative overflow-hidden rounded-lg bg-muted mx-auto select-none"
        :style="natW ? { width: dispW + 'px', height: dispH + 'px' } : { width: '100%', height: '200px' }"
      >
        <div v-if="!natW" class="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
          Loading…
        </div>

        <img
          v-if="srcUrl"
          ref="imgEl"
          :src="srcUrl"
          :width="dispW || undefined"
          :height="dispH || undefined"
          class="block"
          draggable="false"
          @load="onImgLoad"
        />

        <template v-if="natW">
          <!-- Shadow mask -->
          <div class="absolute inset-x-0 top-0 bg-black/50 pointer-events-none" :style="{ height: box.y + 'px' }" />
          <div class="absolute inset-x-0 bottom-0 bg-black/50 pointer-events-none" :style="{ top: (box.y + box.h) + 'px' }" />
          <div class="absolute bg-black/50 pointer-events-none" :style="{ top: box.y + 'px', left: 0, width: box.x + 'px', height: box.h + 'px' }" />
          <div class="absolute bg-black/50 pointer-events-none" :style="{ top: box.y + 'px', left: (box.x + box.w) + 'px', right: 0, height: box.h + 'px' }" />

          <!-- Crop box -->
          <div
            class="absolute border-2 border-white/80 cursor-move"
            :style="{ left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px' }"
            @pointerdown="onMoveDown"
          >
            <!-- Rule-of-thirds -->
            <div class="absolute inset-0 pointer-events-none opacity-30">
              <div class="absolute top-1/3 inset-x-0 border-t border-white" />
              <div class="absolute top-2/3 inset-x-0 border-t border-white" />
              <div class="absolute left-1/3 inset-y-0 border-l border-white" />
              <div class="absolute left-2/3 inset-y-0 border-l border-white" />
            </div>

            <!-- Corner resize handles -->
            <div class="absolute -top-1.5 -left-1.5  size-4 bg-white rounded-sm cursor-nw-resize" @pointerdown="e => onResizeDown('tl', e)" />
            <div class="absolute -top-1.5 -right-1.5 size-4 bg-white rounded-sm cursor-ne-resize" @pointerdown="e => onResizeDown('tr', e)" />
            <div class="absolute -bottom-1.5 -left-1.5  size-4 bg-white rounded-sm cursor-sw-resize" @pointerdown="e => onResizeDown('bl', e)" />
            <div class="absolute -bottom-1.5 -right-1.5 size-4 bg-white rounded-sm cursor-se-resize" @pointerdown="e => onResizeDown('br', e)" />
          </div>
        </template>
      </div>

      <!-- Actions -->
      <div class="flex justify-end gap-2 pt-1">
        <Button variant="outline" size="sm" @click="$emit('cancel')">Cancel</Button>
        <Button size="sm" :disabled="!natW" @click="applyCrop">Apply</Button>
      </div>

    </div>
  </Dialog>
</template>
