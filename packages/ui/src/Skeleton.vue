<template>
  <div class="relative overflow-hidden bg-muted rounded-sm">
    <div class="skeleton-shimmer absolute inset-0" />
  </div>
</template>

<style scoped>
.skeleton-shimmer {
  background: linear-gradient(
    90deg,
    transparent 0%,
    oklch(var(--muted-foreground) / 0.12) 50%,
    transparent 100%
  );
  animation: shimmer 1.6s ease-in-out infinite;
}

@keyframes shimmer {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
</style>
