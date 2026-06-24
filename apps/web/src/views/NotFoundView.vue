<script setup>
import { useRouter } from 'vue-router'
const router = useRouter()
</script>

<template>
  <div class="flex flex-col items-center justify-center h-dvh gap-4 text-center px-6">
    <p class="text-7xl font-bold text-foreground/10 select-none">404</p>
    <div class="space-y-1">
      <p class="text-base font-semibold text-foreground">Page not found</p>
      <p class="text-sm text-muted-foreground">The page you're looking for doesn't exist.</p>
    </div>
    <button
      class="mt-2 text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4"
      @click="router.back()"
    >
      Go back
    </button>
  </div>
</template>
