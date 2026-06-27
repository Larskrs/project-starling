<script setup>
import { ref } from 'vue'
import { useAuth } from '../composables/useAuth.js'
import Button from '@starling/ui/Button'
import Input  from '@starling/ui/Input'
import Label  from '@starling/ui/Label'

const { register } = useAuth()

const first_name   = ref('')
const last_name    = ref('')
const email        = ref('')
const password     = ref('')
const error        = ref('')
const loading      = ref(false)

async function handleSubmit() {
  error.value   = ''
  loading.value = true
  try {
    await register(email.value, first_name.value, last_name.value, password.value)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Teleport to="#auth-panel" defer>
    <div />
  </Teleport>

  <div class="flex flex-col max-w-sm w-full">

    <!-- Header -->
    <div class="mb-8 text-center">
      <h1 class="text-2xl font-semibold tracking-tight text-foreground">{{ $t('auth.createAccount') }}</h1>
      <p class="mt-1 text-sm text-muted-foreground">{{ $t('auth.createAccountSubtitle') }}</p>
    </div>

    <!-- Card -->
    <div class="rounded-lg border border-border bg-card p-6 shadow-sm">
      <form @submit.prevent="handleSubmit" class="space-y-4">

        <div class="space-y-1.5">
          <Label for="first_name">{{ $t('auth.firstName') }}</Label>
          <Input
            id="first_name"
            v-model="first_name"
            type="text"
            placeholder="Jane"
            autocomplete="given-name"
            required
          />
          <Label for="last_name">{{ $t('auth.lastName') }}</Label>
          <Input
            id="last_name"
            v-model="last_name"
            type="text"
            placeholder="Doe"
            autocomplete="family-name"
            required
          />
        </div>

        <div class="space-y-1.5">
          <Label for="email">{{ $t('auth.email') }}</Label>
          <Input
            id="email"
            v-model="email"
            type="email"
            placeholder="you@example.com"
            autocomplete="email"
            required
          />
        </div>

        <div class="space-y-1.5">
          <Label for="password">{{ $t('auth.password') }}</Label>
          <Input
            id="password"
            v-model="password"
            type="password"
            :placeholder="$t('auth.password')"
            autocomplete="new-password"
            required
            minlength="8"
          />
        </div>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

        <Button type="submit" class="w-full" :disabled="loading">
          {{ loading ? $t('auth.creatingAccount') : $t('auth.createAccount') }}
        </Button>

      </form>
    </div>

    <!-- Footer -->
    <p class="mt-4 text-center text-sm text-muted-foreground">
      {{ $t('auth.alreadyHaveAccount') }}
      <RouterLink to="/login" class="font-medium text-primary underline-offset-4 hover:underline">
        {{ $t('auth.signIn') }}
      </RouterLink>
    </p>

  </div>
</template>
