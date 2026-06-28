<script setup>
defineProps({
  title: { type: String, required: true },
})
</script>

<template>
  <div class="flex items-center justify-between px-5 py-3.5 border-b border-border">
    <h2 class="text-sm font-semibold">{{ title }}</h2>
    <slot name="action" />
  </div>
</template>
