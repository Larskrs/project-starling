<script setup>
import { computed } from 'vue'
import Image from './Image.vue'

const props = defineProps({
  id:      { type: String,  default: null },
  alt:     { type: String,  default: '' },
  quality: { type: Number,  default: 34 },
  // When set, the no-image fallback is tinted with a stable colour derived
  // from this timestamp, so every user keeps a distinct, consistent avatar
  // colour behind their initials. Ignored when an image `id` is present;
  // omit it entirely for non-user avatars (company / production logos) to
  // keep the neutral fallback.
  createdAt: { type: [String, Number, Date], default: null },
})

const fallbackStyle = computed(() => {
  if (!props.createdAt) return null
  const ts = new Date(props.createdAt).getTime()
  if (Number.isNaN(ts)) return null
  // Multiplying seconds by a value coprime with 360 spreads accounts created
  // moments apart across the full hue wheel instead of clustering them.
  const hue = (Math.floor(ts / 1000) * 47) % 360
  return {
    backgroundColor: `oklch(72% 0.14 ${hue})`,
    color:           `oklch(30% 0.07 ${hue})`,
  }
})
</script>

<template>
  <div
    class="overflow-hidden bg-secondary flex items-center justify-center text-muted-foreground text-sm font-semibold select-none"
    :style="!id ? fallbackStyle : null"
  >
    <Image v-if="id" :id="id" :alt="alt" :quality="quality" class="w-full h-full object-cover" />
    <slot v-else />
  </div>
</template>
