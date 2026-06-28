<script setup>
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Icon } from '@iconify/vue'
import { useApi } from '../../../composables/useApi.js'

const emit = defineEmits(['created'])

const route      = useRoute()
const { t }      = useI18n()
const { $fetch } = useApi()

const newName   = ref('')
const newHue    = ref(200)
const creating  = ref(false)
const createErr = ref('')

async function createRole() {
  if (!newName.value.trim()) return
  creating.value  = true
  createErr.value = ''
  const { ok, data, error } = await $fetch(
    `/api/company/${route.params.cslug}/production/${route.params.pslug}/roles`,
    { method: 'POST', json: { name: newName.value.trim(), hue: newHue.value, permissions: '0' }, silent: true },
  )
  creating.value = false
  if (!ok) { createErr.value = error ?? t('roles.failedToCreate'); return }
  emit('created', { ...data, permissions: BigInt(data.permissions) })
  newName.value = ''
  newHue.value  = 200
}
</script>

<template>
  <div class="rounded-xl border border-border p-4 space-y-3">
    <p class="text-sm font-medium text-foreground">{{ $t('roles.createRole') }}</p>
    <div class="flex gap-2">
      <input
        v-model="newName"
        type="text"
        :placeholder="$t('roles.roleNamePlaceholder')"
        maxlength="64"
        class="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        @keydown.enter="createRole"
      />
      <div class="flex items-center gap-2">
        <input v-model.number="newHue" type="range" min="0" max="360" class="w-24 accent-primary" />
        <span class="size-4 rounded-full shrink-0" :style="{ backgroundColor: `oklch(65% 0.18 ${newHue})` }" />
      </div>
      <button
        class="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
        :disabled="!newName.trim() || creating"
        @click="createRole"
      >
        <Icon v-if="creating" icon="mdi:loading" class="animate-spin" />
        {{ $t('roles.create') }}
      </button>
    </div>
    <p v-if="createErr" class="text-xs text-destructive">{{ createErr }}</p>
  </div>
</template>
