<template>
  <div class="flex flex-col gap-0.5">
    <p class="text-xs text-muted-foreground tracking-wide">{{ date }}</p>
    <h1 class="text-2xl font-semibold tracking-tight">
      {{ $t(greetingKey) }}, {{ firstName }}.
    </h1>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../../composables/useAuth'
import { greetingKey as getGreetingKey } from '../../lib/utils'

const { locale } = useI18n()
const { user } = useAuth()

const greetingKey = getGreetingKey()
const firstName   = computed(() => user.value?.first_name ?? user.value?.name ?? '')

const localeMap = { en: 'en-US', no: 'nb-NO' }
const date = computed(() =>
  new Date().toLocaleDateString(localeMap[locale.value] ?? 'en-US', { weekday: 'long', month: 'long', day: 'numeric' })
)
</script>
