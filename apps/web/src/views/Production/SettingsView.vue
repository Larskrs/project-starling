<script setup>
import { inject } from 'vue'

const data = inject('production-data')
</script>

<template>
  <div class="p-6">
    <h2 class="text-lg font-semibold text-foreground mb-1">Settings</h2>
    <p class="text-sm text-muted-foreground">Production settings for <span class="font-medium text-foreground">{{ data?.production.name }}</span>.</p>
  </div>
</template>
