<script setup>
import { ref, computed, watch } from 'vue'
import Skeleton from './Skeleton.vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  id:      { type: String, default: null },
  quality: { type: Number, default: 67 },
  alt:     { type: String, default: '' },
})

const loaded = ref(false)
const src = computed(() =>
  props.id ? `/api/storage/${props.id}/serve?quality=${props.quality}` : null,
)

watch(src, () => { loaded.value = false })
</script>

<template>
  <div v-if="src" class="relative overflow-hidden" v-bind="$attrs">
    <Skeleton
      class="absolute inset-0 pointer-events-none transition-opacity duration-500 rounded-none"
      :class="loaded ? 'opacity-0' : 'opacity-100'"
    />
    <img
      :src="src"
      :alt="alt"
      class="w-full h-full object-cover block"
      @load="loaded = true"
    />
  </div>
</template>
