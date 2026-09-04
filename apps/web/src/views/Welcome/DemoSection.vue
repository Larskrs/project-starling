<script setup lang="ts">
/**
 * One "here is the thing itself" block: a short heading and the live example
 * under it. The copy is deliberately three lines at most — the demo is the
 * argument, the words only say where to look.
 */
defineProps<{
  eyebrow: string
  title:   string
  text:    string
}>()
</script>

<template>
  <section class="flex flex-col gap-5">
    <div class="flex flex-col gap-2">
      <span class="text-xs font-semibold uppercase tracking-widest text-primary">{{ eyebrow }}</span>
      <h2 class="text-2xl font-semibold tracking-tight sm:text-3xl">{{ title }}</h2>
      <p class="max-w-xl text-base text-muted-foreground">{{ text }}</p>
      <div v-if="$slots.hints" class="mt-1 flex flex-wrap gap-2">
        <slot name="hints" />
      </div>
    </div>

    <slot />
  </section>
</template>
