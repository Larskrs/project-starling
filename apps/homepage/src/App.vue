<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Avatar from '@starling/ui/Avatar'
import Button from '@starling/ui/Button'
import DebugProvider from '@starling/ui/DebugProvider'
import Skeleton from '@starling/ui/Skeleton'
import { useLocale, type MessageKey } from './useLocale'

interface MeUser {
  id:            string
  email:         string
  name:          string
  first_name:    string | null
  last_name:     string | null
  avatarImageId: string | null
  createdAt:     string
}

const { t, toggleLocale } = useLocale()

const user    = ref<MeUser | null>(null)
const checked = ref(false)

onMounted(async () => {
  try {
    const res = await fetch('/api/auth/me')
    if (res.ok) user.value = (await res.json()).user
  } catch {
    // API unreachable — behave like a guest
  } finally {
    checked.value = true
  }
})

const firstName = computed(() => user.value?.first_name || user.value?.name || '')
const initial   = computed(() => (firstName.value[0] ?? '?').toUpperCase())

const debugRoutes = ['/', '/app', '/app/login']

const features: { icon: string; key: string }[] = [
  { icon: '🎬', key: 'timelines' },
  { icon: '🎚️', key: 'tracks' },
  { icon: '🗂️', key: 'files' },
  { icon: '👥', key: 'teams' },
]
</script>

<template>
  <DebugProvider :routes="debugRoutes" :toggle-locale="toggleLocale">
    <div class="min-h-dvh flex flex-col">
      <header class="mx-auto w-full max-w-6xl px-6 py-6 flex items-center justify-between">
        <a href="/" class="flex items-center gap-2.5">
          <span class="grid h-8 w-8 place-items-center rounded-lg bg-primary font-bold text-primary-foreground">C</span>
          <span class="text-xl font-bold tracking-tight">Cino</span>
        </a>

        <nav v-if="checked" class="flex items-center gap-3">
          <template v-if="user">
            <Avatar
              :id="user.avatarImageId"
              :created-at="user.createdAt"
              :alt="user.name"
              class="h-9 w-9 rounded-full"
            >{{ initial }}</Avatar>
            <Button as="a" href="/app">{{ t('nav.openApp') }}</Button>
          </template>
          <template v-else>
            <Button as="a" variant="ghost" href="/app/login">{{ t('nav.signIn') }}</Button>
            <Button as="a" href="/app">{{ t('nav.getStarted') }}</Button>
          </template>
        </nav>
      </header>

      <main class="flex-1">
        <!-- Session check in flight: skeleton hero, no content jump -->
        <section v-if="!checked" class="mx-auto max-w-6xl px-6 pt-24 pb-20" aria-hidden="true">
          <div class="flex flex-col items-center gap-6">
            <Skeleton class="h-12 w-full max-w-2xl rounded-lg" />
            <Skeleton class="h-12 w-full max-w-lg rounded-lg" />
            <Skeleton class="mt-4 h-6 w-full max-w-xl rounded-lg" />
            <Skeleton class="mt-6 h-12 w-64 rounded-lg" />
          </div>
        </section>

        <!-- Signed in: jump straight back into the app -->
        <section v-else-if="user" class="mx-auto max-w-6xl px-6 pt-24 pb-20 text-center">
          <p class="text-sm font-semibold uppercase tracking-[0.18em] text-primary">{{ t('welcome.eyebrow') }}</p>
          <h1 class="mx-auto mt-4 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
            {{ t('welcome.title', { name: firstName }) }}
          </h1>
          <p class="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">{{ t('welcome.lede') }}</p>

          <div class="mx-auto mt-12 flex max-w-md flex-col items-center gap-5 rounded-lg border bg-card p-6 text-left shadow-sm sm:flex-row">
            <Avatar
              :id="user.avatarImageId"
              :created-at="user.createdAt"
              :alt="user.name"
              class="h-14 w-14 shrink-0 rounded-full text-lg"
            >{{ initial }}</Avatar>
            <div class="min-w-0 flex-1 text-center sm:text-left">
              <p class="truncate font-semibold">{{ user.name }}</p>
              <p class="truncate text-sm text-muted-foreground">{{ user.email }}</p>
            </div>
            <Button as="a" size="lg" href="/app" class="shrink-0">{{ t('welcome.launch') }} →</Button>
          </div>
        </section>

        <!-- Guest: pitch the product -->
        <section v-else class="mx-auto max-w-6xl px-6 pt-24 pb-20 text-center">
          <h1 class="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
            {{ t('hero.title') }}
          </h1>
          <p class="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl">{{ t('hero.lede') }}</p>
          <div class="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button as="a" size="lg" href="/app">{{ t('nav.getStarted') }}</Button>
            <Button as="a" size="lg" variant="outline" href="/app/login">{{ t('nav.signIn') }}</Button>
          </div>
        </section>

        <section class="mx-auto w-full max-w-6xl px-6 pb-24">
          <h2 class="mb-10 text-center text-2xl font-semibold tracking-tight">{{ t('features.title') }}</h2>
          <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <article
              v-for="feature in features"
              :key="feature.key"
              class="rounded-lg border bg-card p-6 transition-colors hover:border-primary/50"
            >
              <span class="grid h-11 w-11 place-items-center rounded-md bg-primary/10 text-xl" aria-hidden="true">
                {{ feature.icon }}
              </span>
              <h3 class="mt-4 font-semibold">{{ t(`features.${feature.key}.title` as MessageKey) }}</h3>
              <p class="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {{ t(`features.${feature.key}.text` as MessageKey) }}
              </p>
            </article>
          </div>
        </section>
      </main>

      <footer class="border-t">
        <div class="mx-auto flex max-w-6xl items-center justify-between px-6 py-8 text-sm text-muted-foreground">
          <p>© {{ new Date().getFullYear() }} Cino</p>
          <a href="/app/login" class="hover:text-foreground transition-colors">{{ t('nav.signIn') }}</a>
        </div>
      </footer>
    </div>
  </DebugProvider>
</template>
