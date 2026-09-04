<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { Button, IconButton, useColorMode } from '@starling/ui'

import StatBand      from './StatBand.vue'
import DemoSection   from './DemoSection.vue'
import TimelineDemo  from './TimelineDemo.vue'
import BehaviourDemo from './BehaviourDemo.vue'
import TeamDemo      from './TeamDemo.vue'

/**
 * What a signed-out visitor gets instead of the home page.
 *
 * The pitch is the product: each section mounts the real component the feature
 * is made of and lets the visitor use it. Only the stat band talks to the API
 * (`GET /api/welcome`, aggregate counts, no session), and it hides itself if
 * that call fails — nothing else on this page needs the server to be up.
 */
const router = useRouter()
const { isDark, toggle } = useColorMode()

// The hints retire once the demo has actually been touched: they exist to get
// the first gesture out of a visitor, not to sit there for the whole visit.
const timelineTouched = ref(false)

const hints = ['scrub', 'drag', 'sources', 'menu'] as const
</script>

<template>
  <div class="flex min-h-dvh flex-col">
    <header class="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
      <div class="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
        <span class="flex items-center gap-2.5">
          <span class="grid size-8 place-items-center rounded-lg bg-primary font-bold text-primary-foreground">C</span>
          <span class="text-xl font-bold tracking-tight">Cino</span>
        </span>

        <nav class="flex items-center gap-2 sm:gap-3">
          <IconButton
            :title="isDark ? $t('nav.switchToLight') : $t('nav.switchToDark')"
            class="p-2"
            @click="toggle"
          >
            <Icon :icon="isDark ? 'mdi:weather-sunny' : 'mdi:weather-night'" class="size-5" />
          </IconButton>
          <Button variant="ghost" @click="router.push('/login')">{{ $t('auth.signIn') }}</Button>
          <Button @click="router.push('/register')">{{ $t('welcome.getStarted') }}</Button>
        </nav>
      </div>
    </header>

    <main class="mx-auto flex w-full max-w-6xl flex-col gap-20 px-6 pb-24 pt-16 sm:gap-24 sm:pt-24">
      <section class="flex flex-col items-center gap-7 text-center">
        <h1 class="max-w-4xl text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
          {{ $t('welcome.title') }}
        </h1>
        <p class="max-w-2xl text-lg text-muted-foreground sm:text-xl">{{ $t('welcome.lede') }}</p>
        <div class="flex flex-col gap-3 sm:flex-row">
          <Button size="lg" @click="router.push('/register')">{{ $t('welcome.getStarted') }}</Button>
          <Button size="lg" variant="outline" @click="router.push('/login')">{{ $t('auth.signIn') }}</Button>
        </div>
      </section>

      <StatBand />

      <DemoSection
        :eyebrow="$t('welcome.demo.timeline.eyebrow')"
        :title="$t('welcome.demo.timeline.title')"
        :text="$t('welcome.demo.timeline.text')"
      >
        <template v-if="!timelineTouched" #hints>
          <span
            v-for="hint in hints"
            :key="hint"
            class="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground"
          >
            {{ $t(`welcome.demo.timeline.hints.${hint}`) }}
          </span>
        </template>

        <TimelineDemo @interacted="timelineTouched = true" />
      </DemoSection>

      <DemoSection
        :eyebrow="$t('welcome.demo.tracks.eyebrow')"
        :title="$t('welcome.demo.tracks.title')"
        :text="$t('welcome.demo.tracks.text')"
      >
        <BehaviourDemo />
      </DemoSection>

      <DemoSection
        :eyebrow="$t('welcome.demo.team.eyebrow')"
        :title="$t('welcome.demo.team.title')"
        :text="$t('welcome.demo.team.text')"
      >
        <TeamDemo />
      </DemoSection>

      <section class="flex flex-col items-center gap-6 rounded-2xl border border-border bg-card px-6 py-14 text-center">
        <h2 class="max-w-2xl text-3xl font-semibold tracking-tight">{{ $t('welcome.closing') }}</h2>
        <Button size="lg" @click="router.push('/register')">{{ $t('welcome.getStarted') }}</Button>
      </section>
    </main>

    <footer class="border-t border-border">
      <div class="mx-auto flex max-w-6xl items-center justify-between px-6 py-8 text-sm text-muted-foreground">
        <p>© {{ new Date().getFullYear() }} Cino</p>
        <RouterLink to="/login" class="transition-colors hover:text-foreground">{{ $t('auth.signIn') }}</RouterLink>
      </div>
    </footer>
  </div>
</template>
