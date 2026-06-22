<script setup>
defineProps({
  src:    { type: String, default: null },
  alt:    { type: String, default: '' },
  height: { type: Number, default: 160 },
})
</script>

<template>
  <div
    class="w-full overflow-hidden bg-secondary relative"
    :style="{ height: height + 'px' }"
  >
    <img
      v-if="src"
      :src="src"
      :alt="alt"
      class="w-full h-full object-cover"
    />
    <div
      v-else
      class="w-full h-full flex items-center justify-center text-muted-foreground/30"
    >
      <slot />
    </div>
  </div>
</template>
