<script setup>
import { computed } from 'vue'

const props = defineProps({
  src:  { type: String, default: null },
  alt:  { type: String, default: '' },
  size: { type: Number, default: 64 },
})

// Unique ID so multiple instances don't share the same clipPath
const clipId = `squircle-${Math.random().toString(36).slice(2)}`

const style = computed(() => ({
  width:  props.size + 'px',
  height: props.size + 'px',
}))
</script>

<template>
  <div class="relative shrink-0" :style="style">
    <!-- Hidden SVG just to register the squircle clipPath -->
    <svg width="0" height="0" style="position:absolute;overflow:hidden">
      <defs>
        <clipPath :id="clipId" clipPathUnits="objectBoundingBox">
          <!-- Mathematical squircle (x⁴+y⁴=r⁴), 8 curves one per octant, perfectly symmetric -->
          <path d="
            M 0.5 0
            C 0.7191 0, 0.8409 0, 0.9205 0.0795
            C 1 0.1591, 1 0.2809, 1 0.5
            C 1 0.7191, 1 0.8409, 0.9205 0.9205
            C 0.8409 1, 0.7191 1, 0.5 1
            C 0.2809 1, 0.1591 1, 0.0795 0.9205
            C 0 0.8409, 0 0.7191, 0 0.5
            C 0 0.2809, 0 0.1591, 0.0795 0.0795
            C 0.1591 0, 0.2809 0, 0.5 0 Z
          " />
        </clipPath>
      </defs>
    </svg>

    <img
      v-if="src"
      :src="src"
      :alt="alt"
      class="w-full h-full object-cover"
      :style="{ clipPath: `url(#${clipId})` }"
    />
    <div
      v-else
      class="w-full h-full bg-secondary flex items-center justify-center text-muted-foreground text-sm font-semibold select-none"
      :style="{ clipPath: `url(#${clipId})` }"
    >
      <slot />
    </div>
  </div>
</template>
