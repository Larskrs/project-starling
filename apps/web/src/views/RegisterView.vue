<script setup>
import { ref } from 'vue'
import { useAuth } from '../composables/useAuth.js'
import Button from '../components/ui/Button.vue'
import Input  from '../components/ui/Input.vue'
import Label  from '../components/ui/Label.vue'

const { register } = useAuth()

const name     = ref('')
const email    = ref('')
const password = ref('')
const error    = ref('')
const loading  = ref(false)

async function handleSubmit() {
  error.value   = ''
  loading.value = true
  try {
    await register(email.value, name.value, password.value)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-background px-4">
    <div class="w-full max-w-sm">

      <!-- Header -->
      <div class="mb-8 text-center">
        <h1 class="text-2xl font-semibold tracking-tight text-foreground">Create an account</h1>
        <p class="mt-1 text-sm text-muted-foreground">Enter your details to get started</p>
      </div>

      <!-- Card -->
      <div class="rounded-lg border border-border bg-card p-6 shadow-sm">
        <form @submit.prevent="handleSubmit" class="space-y-4">

          <div class="space-y-1.5">
            <Label for="name">Full name</Label>
            <Input
              id="name"
              v-model="name"
              type="text"
              placeholder="Jane Doe"
              autocomplete="name"
              required
            />
          </div>

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
              placeholder="Minimum 8 characters"
              autocomplete="new-password"
              required
              minlength="8"
            />
          </div>

          <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

          <Button type="submit" class="w-full" :disabled="loading">
            {{ loading ? 'Creating account…' : 'Create account' }}
          </Button>

        </form>
      </div>

      <!-- Footer -->
      <p class="mt-4 text-center text-sm text-muted-foreground">
        Already have an account?
        <RouterLink to="/login" class="font-medium text-primary underline-offset-4 hover:underline">
          Sign in
        </RouterLink>
      </p>

    </div>
  </div>
</template>
