<script setup>
import { computed } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  id: { type: String, default: null },
  quality: { type: Number, default: 67 },
})

const src = computed(() =>
  props.id ? `/api/storage/${props.id}/serve?quality=${props.quality}` : null,
)
</script>

<template>
  <img v-if="src" :src="src" v-bind="$attrs" />
</template>
