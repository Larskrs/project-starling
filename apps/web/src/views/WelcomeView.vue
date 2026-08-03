<script setup>
import { RouterLink } from 'vue-router'
import { Icon }       from '@iconify/vue'
import Button         from '@starling/ui/Button'

// What a signed-out visitor gets instead of the home page. Deliberately
// self-contained (no app chrome, no API calls) — it must render for someone
// with no session at all.
const features = [
  { icon: 'mdi:movie-open-play-outline', key: 'timelines' },
  { icon: 'mdi:tune-vertical',           key: 'tracks' },
  { icon: 'mdi:folder-multiple-outline', key: 'files' },
  { icon: 'mdi:account-group-outline',   key: 'teams' },
]
</script>

<template>
  <div class="min-h-dvh flex flex-col">
    <header class="mx-auto w-full max-w-5xl px-6 py-6 flex items-center justify-between">
      <span class="flex items-center gap-2.5">
        <span class="grid size-8 place-items-center rounded-lg bg-primary font-bold text-primary-foreground">C</span>
        <span class="text-xl font-bold tracking-tight">Cino</span>
      </span>

      <nav class="flex items-center gap-3">
        <Button variant="ghost" @click="$router.push('/login')">{{ $t('auth.signIn') }}</Button>
        <Button @click="$router.push('/register')">{{ $t('welcome.getStarted') }}</Button>
      </nav>
    </header>

    <main class="flex-1">
      <section class="mx-auto max-w-5xl px-6 pt-20 pb-16 text-center">
        <h1 class="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          {{ $t('welcome.title') }}
        </h1>
        <p class="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">{{ $t('welcome.lede') }}</p>
        <div class="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button size="lg" @click="$router.push('/register')">{{ $t('welcome.getStarted') }}</Button>
          <Button size="lg" variant="outline" @click="$router.push('/login')">{{ $t('auth.signIn') }}</Button>
        </div>
      </section>

      <section class="mx-auto w-full max-w-5xl px-6 pb-24">
        <h2 class="mb-10 text-center text-2xl font-semibold tracking-tight">{{ $t('welcome.featuresTitle') }}</h2>
        <div class="grid gap-5 sm:grid-cols-2">
          <article
            v-for="feature in features"
            :key="feature.key"
            class="rounded-xl border border-border bg-card p-6"
          >
            <span class="grid size-11 place-items-center rounded-md bg-primary/10 text-xl text-primary">
              <Icon :icon="feature.icon" />
            </span>
            <h3 class="mt-4 font-semibold">{{ $t(`welcome.features.${feature.key}.title`) }}</h3>
            <p class="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {{ $t(`welcome.features.${feature.key}.text`) }}
            </p>
          </article>
        </div>
      </section>
    </main>

    <footer class="border-t border-border">
      <div class="mx-auto flex max-w-5xl items-center justify-between px-6 py-8 text-sm text-muted-foreground">
        <p>© {{ new Date().getFullYear() }} Cino</p>
        <RouterLink to="/login" class="transition-colors hover:text-foreground">{{ $t('auth.signIn') }}</RouterLink>
      </div>
    </footer>
  </div>
</template>
