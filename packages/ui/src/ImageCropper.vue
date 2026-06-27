<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import Dialog        from './Dialog.vue'
import DialogContent from './DialogContent.vue'
import DialogHeader  from './DialogHeader.vue'
import DialogTitle   from './DialogTitle.vue'
import DialogFooter  from './DialogFooter.vue'
import Button        from './Button.vue'
import { Icon } from '@iconify/vue'

const props = defineProps({
  file:        { type: File,   default: null },
  aspectRatio: { type: Number, default: 1    },
  maxOutput:   { type: Number, default: 1200 },
})
const emit = defineEmits(['crop', 'cancel'])

const MIN_DIM = 40
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// ── Image ───────────────────────────────────────────────────────────────────
// One <img>: visible *and* the drawImage source. drawImage reads natural-space
// source coords, so the element's CSS size is irrelevant — no second ref needed.
const open   = computed(() => !!props.file)
const srcUrl = ref('')
const imgEl  = ref(null)
const natW   = ref(0)
const natH   = ref(0)
const maxW   = ref(740)
const maxH   = ref(560)

watch(() => props.file, file => {
  if (srcUrl.value) URL.revokeObjectURL(srcUrl.value)
  natW.value = natH.value = 0
  srcUrl.value = file ? URL.createObjectURL(file) : ''
}, { immediate: true })

const scale = computed(() =>
  natW.value ? Math.min(maxW.value / natW.value, maxH.value / natH.value, 1) : 1)
const dispW = computed(() => Math.round(natW.value * scale.value))
const dispH = computed(() => Math.round(natH.value * scale.value))
const stageStyle = computed(() => ({ width: dispW.value + 'px', height: dispH.value + 'px' }))

function onLoaded() {
  natW.value = imgEl.value.naturalWidth
  natH.value = imgEl.value.naturalHeight
  // Size the stage to the viewport at open time (modal is short-lived, so no
  // need to react to live resize and re-clamp the box).
  maxW.value = Math.min(740, window.innerWidth  - 120)
  maxH.value = Math.min(560, window.innerHeight - 220)
  resetBox()
}

// ── Crop box (display-space px) ──────────────────────────────────────────────
const box = reactive({ x: 0, y: 0, w: 0, h: 0 })

function resetBox() {
  const ar = props.aspectRatio
  let w = dispW.value, h = w / ar
  if (h > dispH.value) { h = dispH.value; w = h * ar }
  box.w = Math.round(w); box.h = Math.round(h)
  box.x = Math.round((dispW.value - box.w) / 2)
  box.y = Math.round((dispH.value - box.h) / 2)
}

// ── Drag ─────────────────────────────────────────────────────────────────────
function drag(onMove) {
  const stop = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', stop)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', stop)
}

function onMoveStart(e) {
  e.preventDefault()
  const ox = e.clientX, oy = e.clientY, bx = box.x, by = box.y
  drag(e => {
    box.x = clamp(bx + e.clientX - ox, 0, dispW.value - box.w)
    box.y = clamp(by + e.clientY - oy, 0, dispH.value - box.h)
  })
}

// Delta-driven resize: dominant axis (AR-normalised) sets the size; the opposite
// corner stays anchored. Robust against pointer-relative runaway.
function onResizeStart(corner, e) {
  e.preventDefault(); e.stopPropagation()
  const ar = props.aspectRatio
  const ox = e.clientX, oy = e.clientY, startW = box.w
  const left = corner.includes('l'), top = corner.includes('t')
  const anchorX = left ? box.x + box.w : box.x
  const anchorY = top  ? box.y + box.h : box.y
  drag(e => {
    const dw = left ? ox - e.clientX : e.clientX - ox
    const dh = top  ? oy - e.clientY : e.clientY - oy
    const delta = Math.abs(dw) >= Math.abs(dh * ar) ? dw : dh * ar
    let newW = Math.max(startW + delta, MIN_DIM)
    newW = Math.min(newW, left ? anchorX : dispW.value - anchorX)
    let newH = Math.min(newW / ar, top ? anchorY : dispH.value - anchorY)
    newW = newH * ar
    box.w = Math.round(newW); box.h = Math.round(newH)
    box.x = Math.round(left ? anchorX - newW : anchorX)
    box.y = Math.round(top  ? anchorY - newH : anchorY)
  })
}

// ── Output dimensions (readout + apply share this) ───────────────────────────
function output() {
  const s = scale.value
  const sw = Math.round(box.w / s), sh = Math.round(box.h / s)
  const os = Math.min(props.maxOutput / sw, props.maxOutput / sh, 1)
  return { sx: Math.round(box.x / s), sy: Math.round(box.y / s), sw, sh,
           ow: Math.round(sw * os), oh: Math.round(sh * os) }
}
const outLabel = computed(() => natW.value ? `${output().ow} × ${output().oh}` : '')

// ── Keyboard: Enter applies, arrows nudge (Shift = 10px) ─────────────────────
function onKey(e) {
  if (!open.value) return
  if (e.key === 'Enter') return e.preventDefault(), apply()
  if (!natW.value) return
  const step = e.shiftKey ? 10 : 1
  const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
  if (nudge) {
    e.preventDefault()
    box.x = clamp(box.x + nudge[0], 0, dispW.value - box.w)
    box.y = clamp(box.y + nudge[1], 0, dispH.value - box.h)
  }
}
onMounted(()   => window.addEventListener('keydown', onKey))
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  if (srcUrl.value) URL.revokeObjectURL(srcUrl.value)
})

// ── Apply ────────────────────────────────────────────────────────────────────
function apply() {
  if (!natW.value || !imgEl.value?.complete) return
  const { sx, sy, sw, sh, ow, oh } = output()
  const c = document.createElement('canvas')
  c.width = ow; c.height = oh
  c.getContext('2d').drawImage(imgEl.value, sx, sy, sw, sh, 0, 0, ow, oh)
  c.toBlob(blob => emit('crop', blob), 'image/jpeg', 0.92)
}
</script>

<template>
  <Dialog :open="open" @update:open="!$event && $emit('cancel')">
    <DialogContent class="w-[92vw] max-w-[840px] p-5 flex flex-col gap-4">

      <DialogHeader>
        <DialogTitle>Crop image</DialogTitle>
      </DialogHeader>

      <!-- Stage: overflow-hidden clips the box-shadow dim to the frame; padding
           keeps the corner handles clear of the edge. -->
      <div class="relative rounded-xl bg-muted/25 overflow-hidden grid place-items-center p-6 min-h-[240px]">

        <!-- Always mounted so it loads; sr-only until decoded, then sized.
             Same element feeds drawImage in apply(). -->
        <div v-if="srcUrl" class="relative select-none touch-none" :style="natW ? stageStyle : null">
          <img
            ref="imgEl"
            :src="srcUrl"
            draggable="false"
            @load="onLoaded"
            :class="natW ? 'block w-full h-full rounded-sm pointer-events-none' : 'sr-only'"
          />

          <p v-if="!natW" class="text-sm text-muted-foreground">Loading…</p>

          <template v-if="natW">
            <!-- Single-element dim: huge spread cuts a window at the box. -->
            <div
              class="absolute pointer-events-none"
              :style="{ left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px',
                        boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)' }"
            />

            <!-- Crop box -->
            <div
              class="absolute cursor-move touch-none border-[3px] border-white rounded-md"
              :style="{ left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px', boxShadow: '0 0 0 1px rgba(0,0,0,0.4)' }"
              @pointerdown="onMoveStart"
            >
              <!-- Corner handles -->
              <div class="absolute -top-2 -left-2 size-5 bg-white rounded cursor-nw-resize shadow touch-none border border-black/10"
                @pointerdown.stop="onResizeStart('tl', $event)" />
              <div class="absolute -top-2 -right-2 size-5 bg-white rounded cursor-ne-resize shadow touch-none border border-black/10"
                @pointerdown.stop="onResizeStart('tr', $event)" />
              <div class="absolute -bottom-2 -left-2 size-5 bg-white rounded cursor-sw-resize shadow touch-none border border-black/10"
                @pointerdown.stop="onResizeStart('bl', $event)" />
              <div class="absolute -bottom-2 -right-2 size-5 bg-white rounded cursor-se-resize shadow touch-none border border-black/10"
                @pointerdown.stop="onResizeStart('br', $event)" />

              <!-- Output size readout -->
              <div class="absolute bottom-1.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md bg-black/65 text-white text-[11px] font-mono tabular-nums pointer-events-none whitespace-nowrap">
                {{ outLabel }}
              </div>
            </div>
          </template>
        </div>
      </div>

      <DialogFooter>
        <p class="text-xs text-muted-foreground mr-auto">Drag · corners to resize · arrows to nudge</p>
        <Button variant="outline" size="sm" @click="$emit('cancel')">Cancel</Button>
        <Button size="sm" :disabled="!natW" @click="apply">Apply</Button>
      </DialogFooter>

    </DialogContent>
  </Dialog>
</template>