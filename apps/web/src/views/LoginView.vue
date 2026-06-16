<script setup>
import { ref } from 'vue'
import { useAuth } from '../composables/useAuth.js'
import Button from '../components/ui/Button.vue'
import Input  from '../components/ui/Input.vue'
import Label  from '../components/ui/Label.vue'

const { login } = useAuth()

const email    = ref('')
const password = ref('')
const error    = ref('')
const loading  = ref(false)

async function handleSubmit() {
  error.value   = ''
  loading.value = true
  try {
    await login(email.value, password.value)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Teleport to="#auth-panel" defer>
    <div class="bg-primary h-full" >
      
    </div>
  </Teleport>

  <div class="flex flex-col max-w-sm w-full">

    <!-- Header -->
    <div class="mb-8 text-center">
      <h1 class="text-2xl font-semibold tracking-tight text-foreground">Welcome back</h1>
      <p class="mt-1 text-sm text-muted-foreground">Sign in to your account to continue</p>
    </div>

    <!-- Card -->
    <div class="rounded-lg border border-border bg-card p-6 shadow-sm">
      <form @submit.prevent="handleSubmit" class="space-y-4">

        <div class="space-y-1.5">
          <Label for="email">Email</Label>
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
          <Label for="password">Password</Label>
          <Input
            id="password"
            v-model="password"
            type="password"
            placeholder="••••••••"
            autocomplete="current-password"
            required
          />
        </div>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

        <Button type="submit" class="w-full" :disabled="loading">
          {{ loading ? 'Signing in…' : 'Sign in' }}
        </Button>

      </form>
    </div>

    <!-- Footer -->
    <p class="mt-4 text-center text-sm text-muted-foreground">
      Don't have an account?
      <RouterLink to="/register" class="font-medium text-primary underline-offset-4 hover:underline">
        Register
      </RouterLink>
    </p>

  </div>
</template>
