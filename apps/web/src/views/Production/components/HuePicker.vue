<script setup>
const model = defineModel({ type: Number, default: 200 })
</script>

<template>
  <div class="flex items-center gap-2.5">
    <input
      type="range"
      min="0"
      max="360"
      v-model.number="model"
      class="flex-1 h-1.5 rounded-full cursor-pointer accent-primary"
    />
    <span
      class="size-4 rounded-full shrink-0 ring-1 ring-border/50"
      :style="{ backgroundColor: `oklch(65% 0.18 ${model})` }"
    />
  </div>
</template>
