<script setup>
import { debugConfig, resetDebugConfig, Skeleton } from '@starling/ui'
import { usePageTitle } from '../../composables/usePageTitle.js'

usePageTitle('Debug Settings')
</script>

<template>
  <div class="max-w-2xl mx-auto px-6 py-10 flex flex-col gap-8">

    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold text-foreground">Debug Settings</h1>
        <p class="text-sm text-muted-foreground mt-0.5">Simulate UI states for development. Settings persist across reloads.</p>
      </div>
      <button
        class="text-xs px-3 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        @click="resetDebugConfig"
      >
        Reset all
      </button>
    </div>

    <!-- Section: Network -->
    <section class="rounded-xl border border-border overflow-hidden">
      <div class="px-5 py-3 bg-muted/40 border-b border-border">
        <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Network</p>
      </div>

      <div class="divide-y divide-border">

        <!-- Fetch delay -->
        <div class="px-5 py-4 flex flex-col gap-3">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-sm font-medium text-foreground">Fetch delay</p>
              <p class="text-xs text-muted-foreground mt-0.5">
                Add artificial latency to every API request. Useful for testing loading and skeleton states.
              </p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span
                class="min-w-[3.5rem] text-right text-sm font-mono tabular-nums"
                :class="debugConfig.fetchDelay > 0 ? 'text-foreground' : 'text-muted-foreground'"
              >
                {{ debugConfig.fetchDelay > 0 ? `${debugConfig.fetchDelay}ms` : 'off' }}
              </span>
              <button
                v-if="debugConfig.fetchDelay > 0"
                class="text-xs text-muted-foreground hover:text-foreground transition-colors"
                @click="debugConfig.fetchDelay = 0"
              >
                ✕
              </button>
            </div>
          </div>

          <input
            type="range"
            min="0"
            max="5000"
            step="100"
            :value="debugConfig.fetchDelay"
            class="w-full accent-primary"
            @input="debugConfig.fetchDelay = Number($event.target.value)"
          />

          <div class="flex justify-between text-[11px] text-muted-foreground select-none">
            <span>Off</span>
            <span>1s</span>
            <span>2s</span>
            <span>3s</span>
            <span>4s</span>
            <span>5s</span>
          </div>
        </div>

        <!-- Skeleton preview -->
        <div class="px-5 py-4">
          <p class="text-xs text-muted-foreground mb-3">Skeleton preview</p>
          <div class="flex gap-3">
            <Skeleton class="h-16 w-16 rounded-lg shrink-0" />
            <div class="flex flex-col gap-2 flex-1 justify-center">
              <Skeleton class="h-3 w-3/4 rounded" />
              <Skeleton class="h-3 w-1/2 rounded" />
              <Skeleton class="h-3 w-2/3 rounded" />
            </div>
          </div>
        </div>

      </div>
    </section>

  </div>
</template>
