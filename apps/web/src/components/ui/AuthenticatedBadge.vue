<template>
  <div class="flex items-center gap-1 rounded px-2.5 py-1">
    <span class="text-sm font-medium text-muted-foreground mr-1">{{ user?.first_name ?? user?.name }}</span>
    <button
      class="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors px-1.5 py-1 rounded"
      :title="locale === 'en' ? 'Switch to Norwegian' : 'Bytt til engelsk'"
      @click="toggleLocale"
    >
      {{ locale === 'en' ? 'NO' : 'EN' }}
    </button>
    <Button size="xs" variant="outline" @click="logout">{{ $t('nav.logOut') }}</Button>
  </div>
</template>

<script setup lang="ts">
import { useAuth } from '../../composables/useAuth'
import { useLocale } from '../../composables/useLocale'
import Button from '@starling/ui/Button'

const { user, logout } = useAuth()
const { locale, toggleLocale } = useLocale()
</script>
