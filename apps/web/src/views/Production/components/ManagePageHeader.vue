<template>
  <div class="flex items-start gap-3">
    <slot name="back" />
    <div class="flex-1 min-w-0">
      <h2 class="text-lg font-semibold text-foreground leading-snug">
        <slot name="title" />
      </h2>
      <p class="text-sm text-muted-foreground mt-0.5">
        <slot name="description" />
      </p>
    </div>
    <slot name="action" />
  </div>
</template>
